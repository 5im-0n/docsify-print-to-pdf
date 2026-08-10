/* docs/print.js — "Print to PDF" button.
 *
 * On click it:
 *   1. reads _sidebar.md to learn the chapters (title + order, same as the sidebar)
 *   2. fetches every chapter markdown file and renders it with markdown-it
 *   3. assembles a printable document: cover page (_media/cover.jpg) + all chapters
 *   4. opens it in a hidden same-origin iframe and calls the browser's print dialog
 *      so the user can "Save as PDF".
 */
(function () {
  'use strict';

  var PROJECT = (window.$docsify && window.$docsify.name) || 'Project';

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
    var re = /\[([^\]]+)\]\(([^)]+)\)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      chapters.push({ title: m[1], file: linkToFile(m[2]) });
    }
    if (!chapters.length) throw new Error('No chapters found in _sidebar.md');
    return chapters;
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
      /* size A4 + zero margins = the printable area is exactly 210x297mm,
         so the cover fills page 1 edge-to-edge (no white border, no bleed
         onto page 2). Chapter pages get their inset from .chapter padding. */
      '@page{size:A4;margin:0}',
      '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      'html,body{margin:0;padding:0}',
      'body{font:12pt/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#333}',
      /* --- cover page (full-bleed A4, exactly one page) --- */
      '.cover-page{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always}',
      '.cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '.cover-content{position:relative;z-index:1;height:100%;display:flex;' +
        'flex-direction:column;justify-content:center;align-items:center;text-align:center;' +
        'color:#fff}',
      '.cover-title{font-size:44pt;font-weight:700;letter-spacing:2px;' +
        'text-shadow:0 2px 14px rgba(0,0,0,.55)}',
      '.cover-subtitle{font-size:14pt;opacity:.95;margin-top:14px;' +
        'text-shadow:0 1px 8px rgba(0,0,0,.55)}',
      /* --- chapters --- */
      '.chapter{page-break-before:always;padding:20mm 18mm}',
      '.chapter h1{font-size:23pt;margin:0 0 14px;padding-bottom:8px;' +
        'border-bottom:2px solid #42b983;color:#2c3e50}',
      '.chapter h2{font-size:16pt;margin:24px 0 8px;color:#2c3e50}',
      '.chapter h3{font-size:13pt;margin:18px 0 6px;color:#2c3e50}',
      '.chapter p{margin:0 0 10px}',
      '.chapter blockquote{margin:10px 0;padding:8px 14px;border-left:4px solid #42b983;' +
        'background:#f6faf8;color:#555;border-radius:0 6px 6px 0}',
      '.chapter blockquote p{margin:0}',
      '.chapter ul,.chapter ol{margin:0 0 10px;padding-left:24px}',
      '.chapter pre{background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;' +
        'padding:12px;overflow:auto;font:10pt/1.5 "Courier New",monospace}',
      '.chapter code{font-family:"Courier New",monospace;background:#f6f8fa;' +
        'padding:1px 5px;border-radius:4px;font-size:10.5pt}',
      '.chapter pre code{background:none;padding:0}',
      '.chapter table{border-collapse:collapse;width:100%;margin:10px 0;font-size:11pt}',
      '.chapter th,.chapter td{border:1px solid #d0d7de;padding:6px 10px;text-align:left}',
      '.chapter th{background:#f6f8fa}',
      '.chapter img{max-width:100%;border-radius:4px}',
      '.chapter hr{border:none;border-top:1px solid #e1e4e8;margin:20px 0}'
    ].join('\n');
  }

  function pageHtml(coverUrl, chaptersHtml) {
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
      chaptersHtml,
      '</body></html>'
    ].join('\n');
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

    var frame = document.getElementById('print-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'print-frame';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;border:0';
      document.body.appendChild(frame);
    }
    var doc = frame.contentDocument;
    doc.open();
    doc.write(pageHtml(coverUrl, chunks.join('\n')));
    doc.close();
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
      await waitForImages(frame.contentDocument);
      await new Promise(function (r) { setTimeout(r, 300); }); // let layout settle
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
