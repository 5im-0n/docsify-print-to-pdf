/* docs/print.js — "Print to PDF" button.
 *
 * On click it:
 *   1. reads _sidebar.md to learn the chapters (title + order, same as the sidebar)
 *   2. fetches every chapter markdown file and renders it with markdown-it
 *   3. assembles a printable document: cover page (_media/cover.jpg) + table of
 *      contents + all chapters, then paginates it into explicit 210x297mm
 *      "sheets" (one sheet = one printed page) and puts a real, absolutely
 *      positioned footer with the page number at the bottom-right of every
 *      page except the cover; the TOC lists every chapter as a uniform row
 *      with its starting page number on the right of each row (nested
 *      chapters are indented under their parent, like in the sidebar)
 *   4. opens it in a hidden same-origin iframe and calls the browser's print
 *      dialog so the user can "Save as PDF".
 *
 * How chapters start is configurable via window.$docsify.print.chapterBreak
 * (see index.html):
 *   'page'    (default) — every chapter starts on a new page and may span
 *                         several pages
 *   'onePage'           — every chapter is scaled down to fit on exactly one
 *                         page (slide-deck style)
 *   'flow'              — no page break: chapters flow continuously, content
 *                         simply continues on the same page
 *
 * Why explicit sheets instead of CSS?
 *   - CSS @page margin boxes (@bottom-right { content: counter(page) }) are not
 *     supported by Chrome/Firefox "Save as PDF".
 *   - A position:fixed footer is laid out by Chromium against a viewport wider
 *     than the page box (so it lands off-page) and is printed only once, not
 *     repeated on every page.
 *   So the only portable way to get a page number on every page is to make
 *   each page a real element and place the footer inside it.
 */
(function () {
  'use strict';

  var PROJECT = (window.$docsify && window.$docsify.name) || 'Project';
  // Table of contents heading — configurable via $docsify.print.tocTitle
  // in index.html (fallback: "Table of Contents").
  var TOC_TITLE = (window.$docsify && window.$docsify.print &&
    window.$docsify.print.tocTitle) || 'Table of Contents';
  // How chapters start in the PDF — window.$docsify.print.chapterBreak:
  //   'page'    (default) — every chapter starts on a new page
  //   'onePage'           — every chapter is scaled to fit on one page
  //   'flow'              — no page break, chapters flow continuously
  var CHAPTER_BREAK = (window.$docsify && window.$docsify.print &&
    window.$docsify.print.chapterBreak) || 'page';

  /* ---------------------------------------------------------------- button */
  function makeButton() {
    var style = document.createElement('style');
    style.textContent =
      '#print-pdf-btn{position:fixed;right:16px;bottom:16px;z-index:99999;' +
      'padding:11px 18px;border:none;border-radius:8px;cursor:pointer;' +
      'background:#42b983;color:#fff;font:600 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.28);transition:background .15s ease}' +
      '#print-pdf-btn:hover{background:#369f6e}' +
      '#print-pdf-btn:active{transform:translateY(1px)}';
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'print-pdf-btn';
    btn.type = 'button';
    btn.textContent = 'Print to PDF';
    btn.title = 'Assemble all chapters + cover and open the print dialog (Save as PDF)';
    btn.addEventListener('click', function () {
      run().catch(function (err) {
        alert('Could not build the PDF:\n' + err.message);
      });
    });
    document.body.appendChild(btn);
  }

  /* --------------------------------------------------------- chapters list */
  function linkToFile(link) {
    if (!link || link === '/') return 'README.md';
    if (link.charAt(link.length - 1) === '/') return link + 'README.md';
    return link + '.md';
  }

  async function getChapters() {
    var res = await fetch('_sidebar.md', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load _sidebar.md');
    var text = await res.text();
    var chapters = [];
    // Capture the leading whitespace so nested sidebar entries (indented with
    // two spaces per level, like in the sidebar itself) can be indented in the
    // table of contents as well.
    var re = /^([ \t]*)- \[([^\]]+)\]\(([^)]+)\)/gm;
    var m;
    while ((m = re.exec(text)) !== null) {
      chapters.push({
        title: m[2],
        file: linkToFile(m[3]),
        depth: Math.floor(m[1].length / 2)
      });
    }
    if (!chapters.length) throw new Error('No chapters found in _sidebar.md');
    return chapters;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------ rendering */
  var md = null;
  function renderer() {
    if (!md) {
      if (typeof window.markdownit !== 'function') {
        throw new Error('markdown-it is not loaded — add it to index.html.');
      }
      md = window.markdownit({ html: true, linkify: true, typographer: true });
    }
    return md;
  }

  /* Make relative image/link URLs absolute against the chapter's folder,
     otherwise they would break inside the standalone print document. */
  function absolutize(root, baseDir) {
    var base = window.location.origin + '/' + (baseDir || '');
    root.querySelectorAll('img').forEach(function (img) {
      var src = img.getAttribute('src');
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      img.src = new URL(src, base).href;
    });
    root.querySelectorAll('a').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) return;
      a.href = new URL(href, base).href;
    });
  }

  /* ------------------------------------------------------------- assembly */
  function styles() {
    return [
      /* A4, zero margins. Every page of the PDF is an explicit .sheet /
         .page-sheet element exactly 210x297mm, so one sheet == one printed
         page and the page-number footer (a real element inside each sheet)
         is guaranteed to appear, independent of the engine's pagination. */
      '@page{size:A4;margin:0}',
      '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      'html,body{margin:0;padding:0}',
      'body{font:12pt/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#333}',
      /* --- cover (page 1, full-bleed, no footer) --- */
      '.cover-page{position:relative;width:210mm;height:297mm;overflow:hidden;' +
        'page-break-after:always;break-after:page}',
      '.cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '.cover-content{position:relative;z-index:1;height:100%;display:flex;' +
        'flex-direction:column;justify-content:center;align-items:center;text-align:center;' +
        'color:#fff}',
      '.cover-title{font-size:44pt;font-weight:700;letter-spacing:2px;' +
        'text-shadow:0 2px 14px rgba(0,0,0,.55)}',
      '.cover-subtitle{font-size:14pt;opacity:.95;margin-top:14px;' +
        'text-shadow:0 1px 8px rgba(0,0,0,.55)}',
      /* --- inner pages (table of contents + chapters) --- */
      '.page-sheet{position:relative;width:210mm;height:297mm;padding:20mm 18mm;' +
        'overflow:hidden;page-break-after:always;break-after:page;background:#fff}',
      /* padding-top/bottom of 0.1px stop the first/last child margins from
         collapsing out of the flow, so scrollHeight measures the real used
         height during pagination */
      '.page-sheet .sheet-flow{position:relative;width:100%;height:100%;' +
        'padding-top:0.1px;padding-bottom:0.1px}',
      '.page-footer{position:absolute;right:16mm;bottom:8mm;' +
        'font:10pt/1 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#667}',
      /* --- table of contents ---
         After pagination the TOC lives inside a .sheet-flow, so these rules
         are scoped with .sheet-flow to win over the generic .sheet-flow h1
         and .sheet-flow ul rules (otherwise the list gets indented 24px and
         the title is restyled by the chapter h1 rule). */
      '.sheet-flow .toc-title{font-size:26pt;font-weight:700;color:#2c3e50;' +
        'margin:0 0 26px;padding-bottom:10px;border-bottom:2px solid #42b983}',
      '.sheet-flow .toc-list{list-style:none;margin:0;padding:0}',
      /* Every chapter is one uniform row: title on the left, page number
         pushed to the right edge of the row. No size/weight differences and
         no separators between rows. Nested chapters are indented under their
         parent, like in the sidebar (the whole row shifts — number and title
         together). */
      '.sheet-flow .toc-list li{display:flex;align-items:baseline;gap:12px;' +
        'padding:6px 0;font-size:13pt;color:#2c3e50}',
      '.sheet-flow .toc-list li.toc-sub{padding-left:16mm}',
      '.sheet-flow .toc-list .toc-no{margin-left:auto;flex:0 0 14mm;' +
        'text-align:right;font-weight:600;color:#42b983;' +
        'font-variant-numeric:tabular-nums}',
      /* --- chapters --- */
      '.sheet-flow h1{font-size:23pt;margin:0 0 14px;padding-bottom:8px;' +
        'border-bottom:2px solid #42b983;color:#2c3e50}',
      '.sheet-flow h2{font-size:16pt;margin:24px 0 8px;color:#2c3e50}',
      '.sheet-flow h3{font-size:13pt;margin:18px 0 6px;color:#2c3e50}',
      '.sheet-flow p{margin:0 0 10px}',
      '.sheet-flow blockquote{margin:10px 0;padding:8px 14px;border-left:4px solid #42b983;' +
        'background:#f6faf8;color:#555;border-radius:0 6px 6px 0}',
      '.sheet-flow blockquote p{margin:0}',
      '.sheet-flow ul,.sheet-flow ol{margin:0 0 10px;padding-left:24px}',
      '.sheet-flow pre{background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;' +
        'padding:12px;overflow:auto;font:10pt/1.5 "Courier New",monospace}',
      '.sheet-flow code{font-family:"Courier New",monospace;background:#f6f8fa;' +
        'padding:1px 5px;border-radius:4px;font-size:10.5pt}',
      '.sheet-flow pre code{background:none;padding:0}',
      '.sheet-flow table{border-collapse:collapse;width:100%;margin:10px 0;font-size:11pt}',
      '.sheet-flow th,.sheet-flow td{border:1px solid #d0d7de;padding:6px 10px;text-align:left}',
      '.sheet-flow th{background:#f6f8fa}',
      '.sheet-flow img{max-width:100%;border-radius:4px}',
      '.sheet-flow hr{border:none;border-top:1px solid #e1e4e8;margin:20px 0}'
    ].join('\n');
  }

  function tocHtml(chapters) {
    // Rows are rendered with an empty .toc-no span; the starting page number
    // of each chapter is only known after pagination, so fillToc() writes it
    // in afterwards (the span keeps its fixed width either way, so filling it
    // in does not change the layout).
    var items = chapters.map(function (ch) {
      // Nested chapters get an indent class so they line up under their
      // parent (same font size/style as every other row).
      var cls = ch.depth > 0 ? ' class="toc-sub"' : '';
      // Title first, number last: with margin-left:auto on .toc-no the
      // number is pushed to the right edge of the row while the title stays
      // anchored at the left (if the number came first, the auto margin
      // would push the whole row — number AND title — to the right).
      return '<li' + cls + '>' +
        '<span class="toc-name">' + escapeHtml(ch.title) + '</span>' +
        '<span class="toc-no"></span>' +
        '</li>';
    }).join('');
    return '<section class="toc-page">' +
      '<h1 class="toc-title">' + escapeHtml(TOC_TITLE) + '</h1>' +
      '<ul class="toc-list">' + items + '</ul>' +
      '</section>';
  }

  /* Phase 1 document: cover + toc + chapters laid out as plain stacked
     sections (no explicit pages yet). paginate() then slices each section
     into one-page sheets and adds the numbered footers. */
  function pageHtml(coverUrl, chapters, chaptersHtml) {
    return [
      '<!DOCTYPE html>',
      '<html><head><meta charset="utf-8">',
      '<title>' + PROJECT + ' — PDF</title>',
      '<style>' + styles() + '</style>',
      '</head><body>',
      '<div class="cover-page">',
      '<img class="cover-img" src="' + coverUrl + '" alt="">',
      '<div class="cover-content">',
      '<div class="cover-title">' + PROJECT + '</div>',
      '<div class="cover-subtitle">Project documentation</div>',
      '</div>',
      '</div>',
      tocHtml(chapters),
      chaptersHtml,
      '</body></html>'
    ].join('\n');
  }

  /* Create an empty one-page sheet (used during pagination). */
  function newSheet(doc) {
    var sheet = doc.createElement('div');
    sheet.className = 'page-sheet';
    var flow = doc.createElement('div');
    flow.className = 'sheet-flow';
    sheet.appendChild(flow);
    return sheet;
  }

  /* Scales the content of a single-sheet flow down (if needed) so that
     everything fits inside the sheet — used by the "onePage" chapter mode.
     The scale is applied as a CSS transform on the flow, so the absolutely
     positioned page-number footer (a sibling of the flow) is unaffected. */
  function fitToPage(flow) {
    var scale = 1;
    if (flow.scrollHeight > flow.clientHeight + 2) {
      scale = Math.min(scale, flow.clientHeight / flow.scrollHeight);
    }
    if (flow.scrollWidth > flow.clientWidth + 2) {
      scale = Math.min(scale, flow.clientWidth / flow.scrollWidth);
    }
    if (scale < 1) {
      flow.style.transformOrigin = 'top left';
      flow.style.transform = 'scale(' + scale + ')';
    }
  }

  /* Slices the phase-1 sections into one-page sheets. Sections are:
     cover-page, toc-page, chapter, chapter, ... (body children in order).
     Every sheet except the cover gets a footer with its real page number.
     Returns the starting page number of each chapter section (in order) so
     the caller can fill the numbers into the table of contents.

     IMPORTANT: every sheet is appended to the document as soon as it is
     created. A sheet that is not in the document has no layout and reports
     scrollHeight/clientHeight = 0, which would silently disable the
     "move to the next sheet when full" logic below (everything would pile
     onto one page and get clipped).

     The page-break behaviour between chapters is controlled by `mode`
     (window.$docsify.print.chapterBreak):
       'page'    — each chapter starts on a fresh page (default)
       'onePage' — each chapter is scaled down to fit on exactly one page
       'flow'    — no page break: chapters flow continuously */
  function paginate(doc, mode) {
    var body = doc.body;
    // Capture the phase-1 sections first, then clear the body: the sections
    // are only needed as containers whose children get moved into sheets.
    var sections = Array.prototype.slice.call(body.children);
    var allSheets = [];
    var chapterStarts = [];
    var prevWasChapter = false;
    body.textContent = '';

    sections.forEach(function (section) {
      if (section.classList.contains('cover-page')) {
        allSheets.push(section); // page 1 — full-bleed, no footer
        body.appendChild(section);
        prevWasChapter = false;
        return;
      }

      var isChapter = section.classList.contains('chapter');
      var children = Array.prototype.slice.call(section.childNodes);
      if (!children.length) children = [doc.createTextNode('')];

      // "onePage": put the whole chapter in a single sheet and scale it down
      // if it doesn't fit, so the chapter never spills onto a second page.
      if (isChapter && mode === 'onePage') {
        chapterStarts.push(allSheets.length + 1);
        var one = newSheet(doc);
        allSheets.push(one);
        body.appendChild(one); // attach so fitToPage() can measure it
        var oneFlow = one.querySelector('.sheet-flow');
        children.forEach(function (child) { oneFlow.appendChild(child); });
        fitToPage(oneFlow);
        prevWasChapter = true;
        return;
      }

      // "flow": from the second chapter on, keep filling the previous sheet
      // instead of forcing a page break. The first chapter (and the TOC)
      // still starts on a fresh page.
      var current = null;
      var flow = null;
      var continueFlow = mode === 'flow' && isChapter && prevWasChapter;
      if (continueFlow) {
        var last = allSheets[allSheets.length - 1];
        if (last && last.classList.contains('page-sheet')) {
          current = last;
          flow = current.querySelector('.sheet-flow');
        }
      }

      if (isChapter) {
        // Page this chapter begins on: the sheet we're continuing on (already
        // counted in allSheets), or the next fresh sheet.
        chapterStarts.push(current ? allSheets.length : allSheets.length + 1);
      }

      children.forEach(function (child) {
        if (!current) {
          current = newSheet(doc);
          allSheets.push(current);
          body.appendChild(current); // attach so it can be measured
          flow = current.querySelector('.sheet-flow');
        }
        flow.appendChild(child);
        // Too tall for the remaining page? Move it to a fresh sheet. Guard
        // with childNodes.length > 1 so a single oversized element (e.g. a
        // very tall image) keeps its own sheet instead of looping forever.
        if (flow.scrollHeight > flow.clientHeight + 2 && flow.childNodes.length > 1) {
          flow.removeChild(child);
          current = newSheet(doc);
          allSheets.push(current);
          body.appendChild(current); // attach so it can be measured
          flow = current.querySelector('.sheet-flow');
          flow.appendChild(child);
        }
      });

      prevWasChapter = isChapter;
    });

    // Number every page but the cover. The sheets are already in the body
    // (they had to be attached during pagination so their heights could be
    // measured), so only the footers are added here.
    var pageNo = 1;
    allSheets.forEach(function (sheet, idx) {
      if (idx > 0) {
        pageNo++;
        var footer = doc.createElement('div');
        footer.className = 'page-footer';
        footer.textContent = String(pageNo);
        sheet.appendChild(footer);
      }
    });

    return chapterStarts;
  }

  /* After pagination, write each chapter's starting page number into the
     matching TOC row. Rows and chapters are in the same order, and the
     number sits on the right edge of every row, after the chapter title. */
  function fillToc(doc, chapterStarts) {
    // The .toc-page wrapper no longer exists at this point: paginate() moved
    // the TOC's children into a sheet and rebuilt the body from sheets, so
    // match the list directly.
    var rows = doc.querySelectorAll('.toc-list li');
    rows.forEach(function (row, i) {
      var no = row.querySelector('.toc-no');
      if (no && chapterStarts[i]) no.textContent = String(chapterStarts[i]);
    });
  }

  function getFrame() {
    var frame = document.getElementById('print-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'print-frame';
      frame.setAttribute('aria-hidden', 'true');
      // Sized to A4 (210x297mm at 96dpi) so on-screen layout matches print.
      // Hidden off-screen (not display:none, which would break measuring/printing).
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0';
      document.body.appendChild(frame);
    }
    return frame;
  }

  async function build() {
    var chapters = await getChapters();
    var chunks = [];
    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      var res = await fetch(ch.file, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Could not load ' + ch.file);
      var markdown = await res.text();
      var holder = document.createElement('div');
      holder.innerHTML = renderer().render(markdown);
      var dir = ch.file.indexOf('/') !== -1 ? ch.file.replace(/[^/]*$/, '') : '';
      absolutize(holder, dir);
      chunks.push('<section class="chapter">' + holder.innerHTML + '</section>');
    }

    var coverUrl = new URL('_media/cover.jpg', window.location.origin + '/').href;

    var frame = getFrame();
    var doc = frame.contentDocument;
    doc.open();
    doc.write(pageHtml(coverUrl, chapters, chunks.join('\n')));
    doc.close();
    await waitForImages(doc);
    await new Promise(function (r) { setTimeout(r, 300); }); // let layout settle
    var chapterStarts = paginate(doc, CHAPTER_BREAK);
    fillToc(doc, chapterStarts);
    await new Promise(function (r) { setTimeout(r, 100); }); // let pagination settle
    return frame;
  }

  function waitForImages(doc) {
    var imgs = Array.prototype.slice.call(doc.images || []);
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }

  function printFrame(frame) {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  async function run() {
    var btn = document.getElementById('print-pdf-btn');
    if (btn) btn.textContent = 'Building PDF…';
    try {
      var frame = await build();
      await new Promise(function (r) { setTimeout(r, 200); });
      printFrame(frame);
    } finally {
      if (btn) btn.textContent = 'Print to PDF';
    }
  }

  /* Exposed for debugging / automated testing. */
  window.printPdf = { build: build, run: run, print: printFrame };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', makeButton);
  } else {
    makeButton();
  }
})();
