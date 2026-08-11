# docsify-print-to-pdf

A "Print to PDF" button for [Docsify](https://docsify.js.org/) that assembles your entire documentation — cover page, table of contents and all chapters — into a single, properly paginated A4 document and opens the browser's print dialog so the user can **Save as PDF**.

## Features

- **One click, whole document** — reads `_sidebar.md` to learn the chapters (title, order and nesting) and renders every chapter into one printable document.
- **Cover page** — uses `_media/cover.jpg` as a full-bleed cover with the project name (taken from `window.$docsify.name`).
- **Table of contents** — lists every chapter with its starting page number on the right; nested chapters are indented under their parent, exactly like the sidebar.
- **Real page numbers** — every page except the cover gets an actual footer with its page number (works in Chrome and Firefox "Save as PDF", where CSS `@page` margin boxes are not supported).
- **Configurable chapter breaks** — chapters can start on a new page, be scaled to one page, or flow continuously (see [Configuration](#configuration)).
- **Self-contained output** — relative images/links are rewritten to absolute URLs so they work inside the standalone print document.

## Requirements

- A Docsify site with:
  - `loadSidebar: true` and a `_sidebar.md` listing the chapters (standard `- [Title](file)` syntax, indented with two spaces per nesting level).
  - A cover image at `_media/cover.jpg` (relative to the site root).
  - [markdown-it](https://github.com/markdown-it/markdown-it) loaded on the page — the plugin uses it to render the markdown of each chapter.

## Usage

### 1. Add the script

Copy `docs/docsify-print-to-pdf.js` into your site (or load it from a CDN, see below) and include it in `index.html` **after** Docsify and markdown-it:

```html
<!-- Docsify -->
<script src="//cdn.jsdelivr.net/npm/docsify@4"></script>
<!-- Markdown renderer used by the Print-to-PDF export -->
<script src="//cdn.jsdelivr.net/npm/markdown-it@13/dist/markdown-it.min.js"></script>
<!-- Print-to-PDF button -->
<script src="docsify-print-to-pdf.js"></script>
```

### 2. Open the site

A green **Print to PDF** button appears in the bottom-right corner of every page. Click it to:

1. build the printable document (cover + table of contents + all chapters),
2. render it in a hidden same-origin iframe,
3. open the browser's print dialog — choose **Save as PDF** (and disable headers/footers in the print dialog for the cleanest result).

### 3. Via jsDelivr (CDN)

The file is also available on jsDelivr, so no local copy is needed — just include it in a script tag:

```html
<script src="https://cdn.jsdelivr.net/gh/5im-0n/docsify-print-to-pdf/docs/print.js"></script>
```

> **Note:** the CDN URL points to `docs/print.js`, which is the published name of this file on the `main` branch of the repository. If you reference the file by its repository path instead, use `docs/docsify-print-to-pdf.js`.

## Configuration

The plugin reads a `print` object from `window.$docsify` in `index.html`:

```js
window.$docsify = {
  name: 'My Project',          // used on the cover page
  loadSidebar: true,
  print: {
    tocTitle: 'Table of Contents',  // heading of the TOC page in the exported PDF
    chapterBreak: 'page'            // how chapters start in the exported PDF
  }
};
```

### `print.tocTitle`

The heading of the table of contents page. Default: `'Table of Contents'`.

### `print.chapterBreak`

How chapters start in the exported PDF:

| Value      | Behaviour                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| `'page'`   | **(default)** every chapter starts on a new page and may span several pages |
| `'onePage'`| every chapter is scaled down to fit on exactly one page (slide-deck style) |
| `'flow'`   | no page break — chapters flow continuously, content continues on the same page |

## How it works

1. Reads `_sidebar.md` to build the ordered chapter list (with nesting depth).
2. Fetches every chapter's markdown file and renders it with `markdown-it` (images/links are absolutized so they survive in the standalone document).
3. Assembles a document: full-bleed cover (`_media/cover.jpg`) → table of contents → all chapters.
4. Paginates the content into explicit `210 × 297 mm` "sheets" (one sheet = one printed page) and places a real, absolutely positioned footer with the page number at the bottom-right of every page except the cover.
5. Renders the result in a hidden same-origin iframe and triggers `print()`, so the user can save it as a PDF.

Explicit sheets are used because CSS `@page` margin boxes (`@bottom-right { content: counter(page) }`) are not supported by Chrome/Firefox "Save as PDF", and a `position: fixed` footer is printed only once by Chromium. Making each page a real element guarantees the page number appears on every page.

## Debugging

The plugin exposes its internals on `window.printPdf` for debugging and automated testing:

```js
printPdf.build();   // build the printable document, returns the iframe
printPdf.run();     // build + open the print dialog
printPdf.print();   // open the print dialog for the last built document
```

## Troubleshooting

- **"markdown-it is not loaded"** — add `<script src="//cdn.jsdelivr.net/npm/markdown-it@13/dist/markdown-it.min.js"></script>` before the plugin.
- **"Could not load _sidebar.md"** — make sure `loadSidebar: true` is set and the file exists next to `index.html`.
- **"No chapters found in _sidebar.md"** — check that sidebar entries use the `- [Title](file)` syntax.
- **Broken images in the PDF** — ensure `_media/cover.jpg` exists and chapter images use relative paths that resolve against the site URL.
