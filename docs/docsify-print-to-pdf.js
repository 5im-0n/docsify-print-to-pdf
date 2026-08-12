/* docs/print.js — "Print to PDF" button.
 *
 * On click it:
 *   1. reads _sidebar.md to learn the chapters (title + order, same as the sidebar)
 *   2. fetches every chapter markdown file and renders it with markdown-it
 *   3. assembles a printable document: table of contents + all chapters, with
 *      an optional full-bleed cover page (print.coverUrl) and an optional
 *      full-bleed back cover page (print.backUrl) — if neither is configured,
 *      neither is inserted — then paginates it into explicit 210x297mm
 *      "sheets" (one sheet = one printed page) and puts a real, absolutely
 *      positioned footer with the page number at the bottom-right of every
 *      page except the cover and the back cover; the TOC lists every chapter
 *      as a uniform row with its starting page number on the right of each
 *      row (nested chapters are indented under their parent, like in the
 *      sidebar) plus the sub-headings (h2/h3/...) of each chapter's markdown
 *      file, indented under their chapter — the depth follows the site's
 *      maxLevel / subMaxLevel settings in index.html
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
 * Orphaned headings can be prevented with
 * window.$docsify.print.keepHeadingsWithNext. When true, an h1-h6 that fits
 * at the bottom of a page is moved to the next page if the content immediately
 * following it does not fit beside it.
 *
 * Hierarchical heading numbers — "1. Introduction", "2. As-Is",
 * "2.1 Architecture", "2.1.1 …" — can be added to the table of contents and
 * to the headings themselves with window.$docsify.print.headingNumbers
 * (see index.html). Chapters are numbered by their sidebar nesting
 * (1, 2, 2.1, 2.2, 3, …); sub-headings continue that hierarchy inside their
 * chapter (## under chapter 2 → 2.1, ### under that → 2.1.1, …).
 * Disabled by default.
 *
 * Long ul/ol lists and tables are split automatically between top-level list
 * items and table rows. Table headers are not repeated by default; set
 * window.$docsify.print.repeatTableHeaders to true to repeat a table's thead
 * on each continuation page. Individual list items and rows remain intact.
 *
 * The cover and back-cover images are configurable via
 * window.$docsify.print.coverUrl and window.$docsify.print.backUrl.
 * Both are optional: when not set, no cover page and no back page are
 * inserted into the PDF.
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
  // Cover image — configurable via $docsify.print.coverUrl in index.html.
  // Optional: when not set (or set to null/false/''), no cover page is
  // inserted into the PDF.
  var COVER_URL = (window.$docsify && window.$docsify.print &&
    window.$docsify.print.coverUrl) || null;
  // Back-cover image — configurable via $docsify.print.backUrl in index.html.
  // Optional: when not set (or set to null/false/''), no back page is
  // inserted into the PDF.
  var BACK_URL = (window.$docsify && window.$docsify.print &&
    window.$docsify.print.backUrl) || null;
  // How chapters start in the PDF — window.$docsify.print.chapterBreak:
  //   'page'    (default) — every chapter starts on a new page
  //   'onePage'           — every chapter is scaled to fit on one page
  //   'flow'              — no page break, chapters flow continuously
  var CHAPTER_BREAK = (window.$docsify && window.$docsify.print &&
    window.$docsify.print.chapterBreak) || 'page';
  // Keep a chapter/subchapter heading with the block immediately following it.
  // This prevents a heading from being left by itself at the bottom of a page.
  // Disabled by default for backwards compatibility.
  var KEEP_HEADINGS_WITH_NEXT = !!(window.$docsify && window.$docsify.print &&
    window.$docsify.print.keepHeadingsWithNext);
  // Long lists and tables are always split between top-level list items and
  // table rows. Repeating a table's <thead> on continuation pages is optional
  // and disabled by default.
  var REPEAT_TABLE_HEADERS = !!(window.$docsify && window.$docsify.print &&
    window.$docsify.print.repeatTableHeaders);
  // Hierarchical heading numbers ("1. Introduction", "2. As-Is",
  // "2.1 Architecture", …) added to the TOC rows and to the headings
  // themselves — optional and disabled by default.
  var HEADING_NUMBERS = !!(window.$docsify && window.$docsify.print &&
    window.$docsify.print.headingNumbers);
  // TOC depth — read from the site's docsify settings in index.html:
  //   maxLevel    (default 4) — maximum nesting depth of TOC rows; sidebar
  //                             entries nested deeper are skipped entirely
  //   subMaxLevel (default 2) — heading levels below the chapter title to
  //                             list from each markdown file (2 = h2 and h3,
  //                             1 = only h2, 0 = chapters only, as before)
  var MAX_LEVEL = (window.$docsify && typeof window.$docsify.maxLevel === 'number')
    ? window.$docsify.maxLevel : 4;
  var SUB_MAX_LEVEL = (window.$docsify && typeof window.$docsify.subMaxLevel === 'number')
    ? window.$docsify.subMaxLevel : 2;

  /* ---------------------------------------------------------------- button */
  function makeButton() {
    var style = document.createElement('style');
    style.textContent =
      '#print-pdf-btn{position:fixed;right:16px;bottom:16px;z-index:99999;' +
      'padding:11px 18px;border:none;border-radius:8px;cursor:pointer;' +
      'background:var(--theme-color,#42b983);color:#fff;font:600 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.28);transition:background .15s ease}' +
      '#print-pdf-btn:hover{background:var(--theme-color-dark,#369f6e)}' +
      '#print-pdf-btn:active{transform:translateY(1px)}';
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'print-pdf-btn';
    btn.type = 'button';
    btn.textContent = 'Print to PDF';
    btn.title = 'Assemble all chapters (and cover, if configured) and open the print dialog (Save as PDF)';
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
    // Respect the site's maxLevel: entries nested deeper than that are not
    // listed in the TOC (and their files are not rendered at all).
    chapters = chapters.filter(function (c) { return c.depth < MAX_LEVEL; });
    if (!chapters.length) throw new Error('No chapters found in _sidebar.md');
    return chapters;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Prefix a heading element with its hierarchical number ("2." for a chapter
     h1, "2.1" for an h2, …) — only used when print.headingNumbers is on. The
     number sits in its own span so it can be styled in the theme color. */
  function prefixHeadingNumber(h, label) {
    var doc = h.ownerDocument;
    var span = doc.createElement('span');
    span.className = 'heading-number';
    span.textContent = label;
    h.insertBefore(span, h.firstChild);
    h.insertBefore(doc.createTextNode(' '), span.nextSibling);
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

  /* Copy the site's --theme-* custom properties (e.g. --theme-color) onto the
     print document's :root. The PDF is assembled in a standalone same-origin
     iframe, which does not inherit CSS variables from the hosting page, so
     this re-declares them there; every var(--theme-*) in styles() then
     resolves to the site's actual docsify theme, with the docsify defaults
     (vue.css) as fallbacks. */
  function themeRoot() {
    var computed = getComputedStyle(document.documentElement);
    var props = [];
    for (var i = 0; i < computed.length; i++) {
      var name = computed[i];
      if (name.indexOf('--theme') === 0) {
        var value = computed.getPropertyValue(name).trim();
        if (value) props.push(name + ':' + value);
      }
    }
    return props.length ? ':root{' + props.join(';') + '}' : '';
  }

  function styles() {
    var css = [
      /* A4, zero margins. Every page of the PDF is an explicit .sheet /
         .page-sheet element exactly 210x297mm, so one sheet == one printed
         page and the page-number footer (a real element inside each sheet)
         is guaranteed to appear, independent of the engine's pagination. */
      '@page{size:A4;margin:0}',
      '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      'html,body{margin:0;padding:0}',
      'body{font:12pt/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
        'color:var(--theme-text-color,#34495e)}',
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
      /* --- back cover (last page, full-bleed, no footer) ---
         No break-before here on purpose: the sheet before it already has
         break-after:page, and combining break-after with a break-before on
         the next element can make the print engine emit an extra blank page
         before the back cover. The preceding sheet's break-after alone
         guarantees the back cover still starts on its own fresh page. */
      '.back-page{position:relative;width:210mm;height:297mm;overflow:hidden;background:#fff}',
      '.back-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
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
      '.sheet-flow .toc-title{font-size:26pt;font-weight:700;' +
        'color:var(--theme-heading-color,#2c3e50);margin:0 0 26px;' +
        'padding-bottom:10px;border-bottom:2px solid var(--theme-color,#42b983)}',
      /* Every row is uniform: title on the left, page number pushed to the
         right edge of the row. No size/weight differences and no separators
         between rows. Rows are indented per nesting level via data-depth
         (rules generated below): chapters by their sidebar depth, sub-heading
         rows by chapter depth + heading level - 1 (the whole row shifts —
         number and title together).
         Rows are plain divs (no <ul> wrapper) on purpose: paginate() slices a
         section's children across sheets, so each row must be its own child
         for a long TOC to span several pages instead of being clipped. */
      '.sheet-flow .toc-row{display:flex;align-items:baseline;gap:12px;' +
        'padding:6px 0;font-size:13pt;color:var(--theme-heading-color,#2c3e50)}',
      /* The leader is the subtle dotted line between the title and the page
         number; it stretches (flex:1) to fill the space and its bottom edge
         (an empty flex item's baseline) sits right on the text baseline. */
      '.sheet-flow .toc-row .toc-leader{flex:1 1 auto;min-width:6mm;' +
        'border-bottom:1px dotted #b9b9b9;height:0}',
      '.sheet-flow .toc-row .toc-no{flex:0 0 14mm;' +
        'text-align:right;font-weight:600;color:var(--theme-color,#42b983);' +
        'font-variant-numeric:tabular-nums}',
      /* Hierarchical heading numbers ("1.", "2.1", …) in TOC rows and on the
         headings themselves — only present when print.headingNumbers is on.
         The TOC number is a span inside .toc-name, so the whole row (number
         and title together) still shifts with the row's data-depth indent. */
      '.sheet-flow .toc-number{font-weight:600;color:var(--theme-color,#42b983);' +
        'font-variant-numeric:tabular-nums;margin-right:8px}',
      '.sheet-flow .heading-number{color:var(--theme-color,#42b983);' +
        'font-variant-numeric:tabular-nums}',
      /* --- chapters --- */
      '.sheet-flow h1{font-size:23pt;margin:0 0 14px;padding-bottom:8px;' +
        'border-bottom:2px solid var(--theme-color,#42b983);' +
        'color:var(--theme-heading-color,#2c3e50)}',
      '.sheet-flow h2{font-size:16pt;margin:24px 0 8px;' +
        'color:var(--theme-heading-color,#2c3e50)}',
      '.sheet-flow h3{font-size:13pt;margin:18px 0 6px;' +
        'color:var(--theme-heading-color,#2c3e50)}',
      '.sheet-flow p{margin:0 0 10px}',
      '.sheet-flow blockquote{margin:10px 0;padding:8px 14px;' +
        'border-left:4px solid var(--theme-blockquote-border,var(--theme-color,#42b983));' +
        'background:var(--theme-blockquote-background,#f6faf8);' +
        'color:var(--theme-blockquote-color,#858585);border-radius:0 6px 6px 0}',
      '.sheet-flow blockquote p{margin:0}',
      '.sheet-flow ul,.sheet-flow ol{margin:0 0 10px;padding-left:24px}',
      '.sheet-flow pre{background:var(--theme-code-background,#f8f8f8);' +
        'border:1px solid #e1e4e8;border-radius:6px;padding:12px;overflow:auto;' +
        'font:10pt/1.5 "Courier New",monospace}',
      '.sheet-flow code{font-family:"Courier New",monospace;' +
        'background:var(--theme-code-background,#f8f8f8);padding:1px 5px;' +
        'border-radius:4px;font-size:10.5pt}',
      '.sheet-flow pre code{background:none;padding:0;' +
        'color:var(--theme-code-color,#525252)}',
      '.sheet-flow table{border-collapse:collapse;width:100%;margin:10px 0;font-size:11pt}',
      '.sheet-flow th,.sheet-flow td{border:1px solid var(--theme-table-border-color,#ddd);' +
        'padding:6px 10px;text-align:left}',
      '.sheet-flow th{background:var(--theme-table-th-background,#f8f8f8)}',
      '.sheet-flow img{max-width:100%;border-radius:4px}',
      '.sheet-flow hr{border:none;border-top:1px solid #eee;margin:20px 0}'
    ];
    // One indent step per nesting level (8mm each — half of the original
    // 16mm), so nested rows line up under their parent like in the sidebar
    // without eating too much width.
    for (var d = 0; d <= MAX_LEVEL; d++) {
      css.push('.sheet-flow .toc-row[data-depth="' + d + '"]{padding-left:' +
        (d * 8) + 'mm}');
    }
    return css.join('\n');
  }

  function tocHtml(chapters) {
    // Rows are rendered with an empty .toc-no span; the page numbers are
    // only known after pagination, so fillToc() writes them in afterwards
    // (the span keeps its fixed width either way, so filling it in does not
    // change the layout). Every row carries a data-toc-target that fillToc()
    // uses to look up its page number: "ch:<i>" for chapters (by sidebar
    // index), "sec:<order>" for sub-headings (the data-toc-order stamped on
    // the heading element in build()).
    // Rows are emitted as plain divs without a <ul> wrapper so paginate()
    // can split a long TOC across several sheets row by row (a single <ul>
    // is one atomic child that cannot be split and would be clipped).
    var items = '';
    chapters.forEach(function (ch, i) {
      // Chapter row — title and nesting depth from the sidebar. With
      // print.headingNumbers the hierarchical chapter number ("1.", "2.",
      // "3.1", …) is prepended to the title.
      var chNum = ch.numberLabel
        ? '<span class="toc-number">' + ch.numberLabel + '</span>'
        : '';
      items += '<div class="toc-row" data-depth="' + ch.depth + '" ' +
        'data-toc-target="ch:' + i + '">' +
        '<span class="toc-name">' + chNum + escapeHtml(ch.title) + '</span>' +
        '<span class="toc-leader"></span>' +
        '<span class="toc-no"></span>' +
        '</div>';
      // Sub-heading rows — collected from the chapter's markdown file in
      // build() (h2..h(subMaxLevel+1)), indented under the chapter by their
      // heading level: h2 = one step, h3 = two steps, etc.
      (ch.sections || []).forEach(function (sec) {
        var secNum = sec.numberLabel
          ? '<span class="toc-number">' + sec.numberLabel + '</span>'
          : '';
        items += '<div class="toc-row" data-depth="' + (ch.depth + sec.level - 1) + '" ' +
          'data-toc-target="sec:' + sec.order + '">' +
          '<span class="toc-name">' + secNum + escapeHtml(sec.title) + '</span>' +
          '<span class="toc-leader"></span>' +
          '<span class="toc-no"></span>' +
          '</div>';
      });
    });
    return '<section class="toc-page">' +
      '<h1 class="toc-title">' + escapeHtml(TOC_TITLE) + '</h1>' +
      items +
      '</section>';
  }

  /* Phase 1 document: (optional cover) + toc + chapters laid out as plain
     stacked sections (no explicit pages yet). paginate() then slices each
     section into one-page sheets and adds the numbered footers. The cover
     page is only emitted when coverUrl is set; the back cover page only
     when backUrl is set (it is dropped later if its image fails to load). */
  function pageHtml(coverUrl, backUrl, chapters, chaptersHtml) {
    var cover = coverUrl
      ? '<div class="cover-page">' +
        '<img class="cover-img" src="' + coverUrl + '" alt="">' +
        '<div class="cover-content">' +
        '<div class="cover-title">' + PROJECT + '</div>' +
        '<div class="cover-subtitle">Project documentation</div>' +
        '</div>' +
        '</div>'
      : '';
    var back = backUrl
      ? '<div class="back-page">' +
        '<img class="back-img" src="' + backUrl + '" alt="">' +
        '</div>'
      : '';
    return [
      '<!DOCTYPE html>',
      '<html><head><meta charset="utf-8">',
      '<title>' + PROJECT + ' — PDF</title>',
      '<style>' + themeRoot() + styles() + '</style>',
      '</head><body>',
      cover,
      tocHtml(chapters),
      chaptersHtml,
      back,
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

  function isHeading(node) {
    return !!(node && node.nodeType === 1 && /^H[1-6]$/.test(node.tagName));
  }

  // Return the previous visible/content node, ignoring the indentation and
  // line-break text nodes produced by rendered HTML.
  function previousContentNode(node) {
    var previous = node && node.previousSibling;
    while (previous && (previous.nodeType === 8 ||
        (previous.nodeType === 3 && !previous.nodeValue.trim()))) {
      previous = previous.previousSibling;
    }
    return previous;
  }

  // If `child` follows one or more headings, return the first heading in that
  // consecutive run. Moving the whole run avoids changing "h1, h2, paragraph"
  // into a different kind of orphan. Return null when the run is already the
  // first content on a fresh page: there is nowhere useful to move it to.
  function headingRunToKeep(flow, child) {
    var heading = previousContentNode(child);
    if (!isHeading(heading)) return null;

    var first = heading;
    var previous = previousContentNode(first);
    while (isHeading(previous)) {
      first = previous;
      previous = previousContentNode(first);
    }
    return previous ? first : null;
  }

  // Move every node from `first` through `last`, including whitespace nodes,
  // out of its current flow and return them in document order.
  function takeNodeRange(flow, first, last) {
    var nodes = [];
    var node = first;
    while (node) {
      var next = node.nextSibling;
      nodes.push(node);
      flow.removeChild(node);
      if (node === last) break;
      node = next;
    }
    return nodes;
  }

  function isSplittableList(node) {
    return !!(node && node.nodeType === 1 &&
      (node.tagName === 'UL' || node.tagName === 'OL'));
  }

  function isSplittableTable(node) {
    return !!(node && node.nodeType === 1 && node.tagName === 'TABLE');
  }

  // Remove IDs from cloned continuation markup. The original ID remains on
  // the first fragment, while continuation lists/tables and repeated table
  // headers avoid introducing duplicate IDs into the print document.
  function removeIds(node) {
    if (!node || node.nodeType !== 1) return;
    node.removeAttribute('id');
    node.querySelectorAll('[id]').forEach(function (withId) {
      withId.removeAttribute('id');
    });
  }

  // Calculate the marker value of every top-level <li>. Continuation <ol>
  // fragments use these values as their `start`, preserving numbering,
  // including custom start/value attributes and reversed lists.
  function listItemsWithNumbers(list) {
    var items = Array.prototype.filter.call(list.children, function (child) {
      return child.tagName === 'LI';
    });
    if (list.tagName !== 'OL') {
      return items.map(function (item) { return { node: item, number: null }; });
    }

    var reversed = list.hasAttribute('reversed');
    var start = parseInt(list.getAttribute('start'), 10);
    var next = isNaN(start) ? (reversed ? items.length : 1) : start;
    return items.map(function (item) {
      var value = parseInt(item.getAttribute('value'), 10);
      if (!isNaN(value)) next = value;
      var result = { node: item, number: next };
      next += reversed ? -1 : 1;
      return result;
    });
  }

  // Return table rows grouped by their direct tbody/tfoot parent. The thead
  // is kept as a header and may optionally be cloned onto continuation pages.
  // Rows inside nested tables are deliberately ignored.
  function tableRowGroups(table) {
    var groups = [];
    Array.prototype.forEach.call(table.children, function (child) {
      if (child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
        var rows = Array.prototype.filter.call(child.children, function (row) {
          return row.tagName === 'TR';
        });
        if (rows.length) groups.push({ template: child, rows: rows });
      } else if (child.tagName === 'TR') {
        groups.push({ template: null, rows: [child] });
      }
    });
    return groups;
  }

  function createTableFragment(doc, source, header, includeHeader, includeCaption) {
    var table = source.cloneNode(false);
    removeIds(table);
    Array.prototype.forEach.call(source.children, function (child) {
      // Column definitions are needed on every fragment to preserve widths.
      // A caption belongs only to the first fragment; the header is controlled
      // separately because repeating it is configurable.
      if (child.tagName === 'COLGROUP' ||
          (includeCaption && child.tagName === 'CAPTION') ||
          (includeHeader && child === header)) {
        var clone = child.cloneNode(true);
        removeIds(clone);
        table.appendChild(clone);
      }
    });
    return table;
  }

  function hasUsefulContentBefore(node, keepHeadingsWithNext) {
    var previous = previousContentNode(node);
    if (!previous) return false;
    if (!keepHeadingsWithNext || !isHeading(previous)) return true;

    // A heading run that starts a fresh page cannot usefully be moved again.
    // In that case an oversized first item/row stays with it and may overflow.
    var first = previous;
    var before = previousContentNode(first);
    while (isHeading(before)) {
      first = before;
      before = previousContentNode(first);
    }
    return !!before;
  }

  function appendTableRow(table, groupTemplate, groupIndex, row) {
    if (!groupTemplate) {
      table.appendChild(row);
      return;
    }
    var group = table.lastElementChild;
    var key = String(groupIndex);
    if (!group || group.getAttribute('data-print-row-group') !== key) {
      group = groupTemplate.cloneNode(false);
      removeIds(group);
      group.setAttribute('data-print-row-group', key);
      table.appendChild(group);
    }
    group.appendChild(row);
  }

  /* Slices the phase-1 sections into one-page sheets. Sections are:
     cover-page, toc-page, chapter, chapter, ..., back-page (body children in
     order). Every sheet except the cover and the back cover gets a footer
     with its real page number.
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
       'flow'    — no page break: chapters flow continuously

     When keepHeadingsWithNext is true, an h1-h6 is moved with the content
     immediately following it if that content overflows the current sheet.

     Lists and tables are always split between top-level list items/table rows.
     Individual items/rows stay intact; repeatTableHeaders controls whether a
     table's thead is copied to each continuation page. */
  function paginate(doc, mode, keepHeadingsWithNext, repeatTableHeaders) {
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

      if (section.classList.contains('back-page')) {
        allSheets.push(section); // last page — full-bleed, no footer
        body.appendChild(section);
        prevWasChapter = false;
        return;
      }

      var isChapter = section.classList.contains('chapter');
      var chapterOrder = isChapter ? chapterStarts.length : -1;
      // Keep a marker on the chapter's first element so its actual starting
      // page can be read after pagination. This matters when orphan prevention
      // moves the chapter heading from a nearly-full sheet to the next one.
      if (isChapter && section.firstElementChild) {
        section.firstElementChild.setAttribute('data-print-chapter-order', String(chapterOrder));
      }
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

      function startSheet() {
        current = newSheet(doc);
        allSheets.push(current);
        body.appendChild(current); // attach so it can be measured
        flow = current.querySelector('.sheet-flow');
      }

      function appendWholeBlock(child) {
        flow.appendChild(child);
        // Too tall for the remaining page? Move it to a fresh sheet. Guard
        // with childNodes.length > 1 so a single oversized element (e.g. a
        // very tall image) keeps its own sheet instead of looping forever.
        if (flow.scrollHeight <= flow.clientHeight + 2 || flow.childNodes.length <= 1) return;

        // Optionally keep a heading (or a consecutive run of headings) with
        // this overflowing block. Without this, the heading can be left as
        // the final visible element on the previous sheet.
        var firstToMove = keepHeadingsWithNext
          ? headingRunToKeep(flow, child)
          : null;
        var nodesToMove = firstToMove
          ? takeNodeRange(flow, firstToMove, child)
          : [child];
        if (!firstToMove) flow.removeChild(child);
        startSheet();
        nodesToMove.forEach(function (node) { flow.appendChild(node); });
      }

      function appendList(list) {
        var entries = listItemsWithNumbers(list);
        // An empty list has nothing useful to split.
        if (!entries.length) {
          appendWholeBlock(list);
          return;
        }

        entries.forEach(function (entry) { list.removeChild(entry.node); });
        var fragment = list;
        flow.appendChild(fragment);

        entries.forEach(function (entry, index) {
          // Items begin inside the source list. Re-append them in order so the
          // same overflow logic works for both the first and later fragments.
          fragment.appendChild(entry.node);
          if (flow.scrollHeight <= flow.clientHeight + 2) return;

          fragment.removeChild(entry.node);
          // If no item fitted, move the heading run and empty list shell off
          // this page before retrying. This keeps a heading with the first item
          // rather than with the complete (possibly multi-page) list.
          if (index === 0 && fragment.children.length === 0) {
            var firstToMove = keepHeadingsWithNext
              ? headingRunToKeep(flow, fragment)
              : null;
            // If the heading already starts a fresh page, moving only an
            // oversized first item would orphan it. Keep both together and
            // allow that indivisible item to overflow instead.
            if (keepHeadingsWithNext && !firstToMove &&
                isHeading(previousContentNode(fragment))) {
              fragment.appendChild(entry.node);
              return;
            }
            var headingNodes = firstToMove
              ? takeNodeRange(flow, firstToMove, fragment)
              : [];
            if (firstToMove) headingNodes.pop(); // discard the empty list shell
            else flow.removeChild(fragment);
            startSheet();
            headingNodes.forEach(function (node) { flow.appendChild(node); });
          } else {
            startSheet();
          }

          fragment = list.cloneNode(false);
          removeIds(fragment);
          if (fragment.tagName === 'OL') fragment.setAttribute('start', String(entry.number));
          flow.appendChild(fragment);
          fragment.appendChild(entry.node);
          // A single item taller than a page deliberately remains intact and
          // may overflow, as configured; the following item starts fresh.
          if (flow.scrollHeight > flow.clientHeight + 2 && index < entries.length - 1 &&
              hasUsefulContentBefore(fragment, keepHeadingsWithNext)) {
            startSheet();
            fragment = list.cloneNode(false);
            removeIds(fragment);
            if (fragment.tagName === 'OL') {
              fragment.setAttribute('start', String(entries[index + 1].number));
            }
            flow.appendChild(fragment);
          }
        });

        // Avoid leaving an empty continuation shell after an oversized item.
        if (!fragment.children.length && fragment.parentNode) {
          fragment.parentNode.removeChild(fragment);
        }
      }

      function appendTable(table) {
        var header = Array.prototype.find.call(table.children, function (child) {
          return child.tagName === 'THEAD';
        });
        var groups = tableRowGroups(table);
        if (!groups.length) {
          appendWholeBlock(table);
          return;
        }

        // Move rows out before attaching the original table: it is the first
        // fragment, preserving captions, colgroups, IDs and other attributes.
        groups.forEach(function (group) {
          group.rows.forEach(function (row) { row.parentNode.removeChild(row); });
          if (group.template && !group.template.children.length && group.template.parentNode) {
            group.template.parentNode.removeChild(group.template);
          }
        });
        var fragment = table;
        flow.appendChild(fragment);
        var rowsAdded = 0;

        groups.forEach(function (group, groupIndex) {
          group.rows.forEach(function (row) {
            appendTableRow(fragment, group.template, groupIndex, row);
            if (flow.scrollHeight <= flow.clientHeight + 2) {
              rowsAdded++;
              return;
            }

            var rowParent = row.parentNode;
            rowParent.removeChild(row);
            if (rowParent !== fragment && !rowParent.children.length) {
              fragment.removeChild(rowParent);
            }

            // As with lists, keep a preceding heading only with the first row.
            if (rowsAdded === 0) {
              var firstToMove = keepHeadingsWithNext
                ? headingRunToKeep(flow, fragment)
                : null;
              // Keep a fresh-page heading with an indivisible oversized first
              // row, even though that row may overflow the page.
              if (keepHeadingsWithNext && !firstToMove &&
                  isHeading(previousContentNode(fragment))) {
                appendTableRow(fragment, group.template, groupIndex, row);
                rowsAdded++;
                return;
              }
              var headingNodes = firstToMove
                ? takeNodeRange(flow, firstToMove, fragment)
                : [];
              if (firstToMove) headingNodes.pop(); // discard the header-only table shell
              else flow.removeChild(fragment);
              startSheet();
              headingNodes.forEach(function (node) { flow.appendChild(node); });
            } else {
              startSheet();
            }

            fragment = createTableFragment(doc, table, header,
              repeatTableHeaders || rowsAdded === 0, rowsAdded === 0);
            flow.appendChild(fragment);
            appendTableRow(fragment, group.template, groupIndex, row);
            rowsAdded++;
          });
        });
      }

      children.forEach(function (child) {
        if (!current) startSheet();
        if (isSplittableList(child)) appendList(child);
        else if (isSplittableTable(child)) appendTable(child);
        else appendWholeBlock(child);
      });

      prevWasChapter = isChapter;
    });

    // A chapter heading can have moved to the next sheet to stay with its
    // following content. Recalculate chapter starts from the markers so the
    // table of contents always points to the heading's actual page.
    doc.querySelectorAll('[data-print-chapter-order]').forEach(function (marker) {
      var sheet = marker.closest('.page-sheet');
      var order = parseInt(marker.getAttribute('data-print-chapter-order'), 10);
      var index = allSheets.indexOf(sheet);
      if (!isNaN(order) && index !== -1) chapterStarts[order] = index + 1;
    });

    // Number every sheet that is not a full-bleed cover or back-cover page.
    // The page counter counts every sheet (so with a cover, the TOC is
    // page 2), but footers are only placed on non-cover/non-back sheets.
    // Previously the first sheet was skipped via "idx > 0" because the cover
    // was always present; now that the cover is optional, skip by class so
    // the numbering stays correct (TOC = page 1 when there is no cover).
    // The sheets are already in the body (they had to be attached during
    // pagination so their heights could be measured), so only the footers
    // are added here.
    var pageNo = 0;
    allSheets.forEach(function (sheet) {
      pageNo++;
      if (sheet.classList.contains('cover-page') ||
          sheet.classList.contains('back-page')) {
        return; // full-bleed page, no footer
      }
      var footer = doc.createElement('div');
      footer.className = 'page-footer';
      footer.textContent = String(pageNo);
      sheet.appendChild(footer);
    });

    return chapterStarts;
  }

  /* After pagination, write the page number into every TOC row. Chapter
     rows get their starting page from chapterStarts (in sidebar order);
     sub-heading rows get the page of the sheet their heading element landed
     on (found via the data-toc-order attribute stamped in build()). Rows
     are matched by their data-toc-target, not by position, because chapters
     and sub-headings are interleaved in the list. */
  function fillToc(doc, chapters, chapterStarts) {
    var pages = {};
    chapters.forEach(function (ch, i) {
      if (chapterStarts[i]) pages['ch:' + i] = chapterStarts[i];
    });
    // Sheets are body children in document order; the +1 matches the footer
    // numbering (cover/back pages count as pages but get no footer), so a
    // sub-heading's page always agrees with the printed footer.
    doc.querySelectorAll('[data-toc-order]').forEach(function (h) {
      var sheet = h.closest('.page-sheet');
      if (!sheet) return;
      var page = Array.prototype.indexOf.call(doc.body.children, sheet) + 1;
      pages['sec:' + h.getAttribute('data-toc-order')] = page;
    });
    doc.querySelectorAll('.toc-row').forEach(function (row) {
      var no = row.querySelector('.toc-no');
      var target = row.getAttribute('data-toc-target');
      if (no && target && pages[target]) no.textContent = String(pages[target]);
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

  /* Resolve a configured asset path to an absolute URL. Absolute URLs
     (http(s):, data:, blob:) pass through untouched; relative paths are
     resolved against the site root, e.g. "_media/cover.jpg". An empty or
     falsy value yields '' — pageHtml() then omits the cover/back page. */
  function resolveAsset(url) {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    return new URL(url, window.location.origin + '/').href;
  }

  async function build() {
    var chapters = await getChapters();
    // Hierarchical chapter numbers ("1.", "2.", "3.1", …) derived from the
    // sidebar nesting — only when print.headingNumbers is enabled. One
    // counter is kept per nesting depth; a deeper chapter resets every
    // counter below it, so nested sidebar entries number as 2.1, 2.2, …
    // under their parent.
    if (HEADING_NUMBERS) {
      var depthCounters = {};
      chapters.forEach(function (ch) {
        depthCounters[ch.depth] = (depthCounters[ch.depth] || 0) + 1;
        for (var d = ch.depth + 1; d <= MAX_LEVEL; d++) delete depthCounters[d];
        var parts = [];
        for (var d2 = 0; d2 <= ch.depth; d2++) parts.push(depthCounters[d2]);
        ch.number = parts;
        // Top-level chapters get a trailing dot ("2."), nested ones do not
        // ("2.1") — same style as the TOC rows in the printed document.
        ch.numberLabel = parts.join('.') + (ch.depth === 0 ? '.' : '');
      });
    }
    var chunks = [];
    // Counter for the data-toc-order attribute stamped on every sub-heading,
    // so fillToc() can find the heading in the paginated document and read
    // the page it landed on.
    var tocOrder = 0;
    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      var res = await fetch(ch.file, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Could not load ' + ch.file);
      var markdown = await res.text();
      var holder = document.createElement('div');
      holder.innerHTML = renderer().render(markdown);
      var dir = ch.file.indexOf('/') !== -1 ? ch.file.replace(/[^/]*$/, '') : '';
      absolutize(holder, dir);
      // Sub-headings of this file (the h1 chapter title itself comes from
      // the sidebar): h2..h(subMaxLevel+1), capped so the total nesting
      // depth never exceeds maxLevel. Each one is stamped with a global
      // data-toc-order so its page number can be found after pagination.
      // With print.headingNumbers the h1 gets the chapter number and every
      // h2+ continues it with standard multilevel counters (2.1, 2.1.1,
      // 2.2, …); numbers are added to all headings, even ones too deep for
      // the TOC, so the document's heading numbers stay continuous.
      var sections = [];
      var secCounters = {};
      var headings = holder.querySelectorAll('h1,h2,h3,h4,h5,h6');
      headings.forEach(function (h) {
        var level = parseInt(h.tagName.charAt(1), 10);
        // Capture the title before the number is prefixed into the heading.
        var title = h.textContent.trim();
        var numberLabel = null;
        if (level === 1) {
          // Chapter title — the chapter number itself ("2." / "3.1").
          numberLabel = ch.numberLabel || null;
        } else {
          // Advance this level's counter and reset every deeper one, then
          // assemble "chapter.sub.subsub…" (e.g. chapter 2, second h2 → 2.2).
          secCounters[level] = (secCounters[level] || 0) + 1;
          for (var l = level + 1; l <= 6; l++) delete secCounters[l];
          var parts = (ch.number || []).concat();
          for (var l2 = 2; l2 <= level; l2++) parts.push(secCounters[l2] || 0);
          numberLabel = parts.join('.');
        }
        if (numberLabel) prefixHeadingNumber(h, numberLabel);
        if (level === 1) return; // chapter title — not a TOC row of its own
        if (level > SUB_MAX_LEVEL + 1) return; // deeper than subMaxLevel
        if (ch.depth + level - 1 >= MAX_LEVEL) return; // deeper than maxLevel
        sections.push({
          title: title,
          level: level,
          order: tocOrder,
          numberLabel: numberLabel
        });
        h.setAttribute('data-toc-order', String(tocOrder));
        tocOrder++;
      });
      ch.sections = sections;
      chunks.push('<section class="chapter">' + holder.innerHTML + '</section>');
    }

    var coverUrl = resolveAsset(COVER_URL);
    var backUrl = resolveAsset(BACK_URL);

    var frame = getFrame();
    var doc = frame.contentDocument;
    doc.open();
    doc.write(pageHtml(coverUrl, backUrl, chapters, chunks.join('\n')));
    doc.close();
    await waitForImages(doc);
    // Drop the back page if its image failed to load, so the PDF never
    // contains a broken back cover.
    var backPage = doc.querySelector('.back-page');
    if (backPage) {
      var backImg = backPage.querySelector('img');
      if (!backImg || !(backImg.complete && backImg.naturalWidth > 0)) {
        backPage.parentNode.removeChild(backPage);
      }
    }
    await new Promise(function (r) { setTimeout(r, 300); }); // let layout settle
    var chapterStarts = paginate(doc, CHAPTER_BREAK, KEEP_HEADINGS_WITH_NEXT,
      REPEAT_TABLE_HEADERS);
    fillToc(doc, chapters, chapterStarts);
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
