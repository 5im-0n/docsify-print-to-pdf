# docsify-print-to-pdf

A "Print to PDF" button for [Docsify](https://docsify.js.org/) that assembles your entire documentation — table of contents and all chapters, plus an optional cover page and back cover page — into a single, properly paginated A4 document and opens the browser's print dialog so the user can **Save as PDF**.

## Features

- **One click, whole document** — reads `_sidebar.md` to learn the chapters (title, order and nesting) and renders every chapter into one printable document.
- **Optional cover page** — if you set `print.coverUrl`, the image is used as a full-bleed cover with the project name (taken from `window.$docsify.name`). When not set, no cover page is inserted.
- **Optional back cover page** — if you set `print.backUrl`, a full-bleed image page is appended at the end of the PDF. When not set, no back page is inserted.
- **Table of contents** — lists every chapter (from the sidebar) with its starting page number on the right, plus the sub-headings (`##`, `###`, …) of each chapter's markdown file with their page numbers; rows are indented under their parent exactly like the sidebar, and the depth follows the site's `maxLevel` / `subMaxLevel` settings (see [Configuration](#configuration)).
- **Clickable headings** — every table-of-contents row is a link to its chapter or sub-heading (clicking it in the saved PDF jumps to that section), and every heading inside the chapters is a link back to the table of contents. Headings keep their exact look — no link colors or underlines are added.
- **Real page numbers** — every page except the (optional) cover and back cover gets an actual footer with its page number (works in Chrome and Firefox "Save as PDF", where CSS `@page` margin boxes are not supported).
- **Configurable chapter breaks** — chapters can start on a new page, be scaled to one page, or flow continuously (see [Configuration](#configuration)).
- **Page breaks inside chapters** — drop a `<!-- page-break -->` comment (or a `<div class="print-page-break"></div>`) on its own line between blocks to force the following content onto a new page in the PDF. Invisible on screen; consecutive breaks, and breaks at the very start or end of a chapter, never create blank pages (see [Page breaks inside a chapter](#page-breaks-inside-a-chapter)).
- **Optional orphan-heading prevention** — `print.keepHeadingsWithNext` moves an `h1`–`h6` to the following page when the content immediately after it cannot fit on the same page.
- **List and table pagination** — long lists split between top-level items and long tables split between rows instead of leaving most of the preceding page blank. Ordered-list numbering continues correctly.
- **Optional repeated table headers** — `print.repeatTableHeaders` repeats `<thead>` on table continuation pages when enabled.
- **Optional heading numbers** — `print.headingNumbers` prepends hierarchical numbers (`1. Introduction`, `2. As-Is`, `2.1 Architecture`, …) to the table-of-contents rows and to the headings themselves.
- **Self-contained output** — relative images/links are rewritten to absolute URLs so they work inside the standalone print document.

## Requirements

- A Docsify site with:
  - `loadSidebar: true` and a `_sidebar.md` listing the chapters (standard `- [Title](file)` syntax, indented with two spaces per nesting level).
  - An **optional** cover image (via `print.coverUrl`) and an **optional** back-cover image (via `print.backUrl`) — if neither is set, the PDF simply starts with the table of contents and ends after the last chapter (see [Configuration](#configuration)).
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

1. build the printable document ((optional) cover + table of contents + all chapters + (optional) back cover),
2. render it in a hidden same-origin iframe,
3. open the browser's print dialog — choose **Save as PDF** (and disable headers/footers in the print dialog for the cleanest result).

### 3. Via jsDelivr (CDN)

The file is published to npm, so no local copy is needed — just include it in a script tag:

```html
<script src="https://cdn.jsdelivr.net/npm/docsify-print-to-pdf@1/docs/docsify-print-to-pdf.js"></script>
```

> The `@1` pins the latest 1.x release; drop it to always get the newest version. The same file is available on unpkg: `https://unpkg.com/docsify-print-to-pdf/docs/docsify-print-to-pdf.js`.

## Configuration

The plugin reads a `print` object from `window.$docsify` in `index.html`:

```js
window.$docsify = {
  name: 'My Project',          // used on the cover page (if any)
  loadSidebar: true,
  print: {
    tocTitle: 'Table of Contents',  // heading of the TOC page in the exported PDF
    coverUrl: '_media/cover.jpg',   // optional — cover image, omit for no cover page
    backUrl: '_media/back.jpg',     // optional — back-cover image, omit for no back page
    chapterBreak: 'page',           // how chapters start in the exported PDF
    keepHeadingsWithNext: true,     // prevent a heading from being orphaned at a page bottom
    repeatTableHeaders: false,      // repeat <thead> on continuation pages (default: false)
    headingNumbers: true            // add hierarchical heading numbers (default: false)
  }
};
```

Both `coverUrl` and `backUrl` are **optional**: when either is not set, the corresponding page is simply not inserted into the PDF.

### `print.tocTitle`

The heading of the table of contents page. Default: `'Table of Contents'`.

### `print.coverUrl`

The cover image of the exported PDF. **Optional** — when not set, no cover page is inserted and the document starts with the table of contents. Any relative path (resolved against the site root) or an absolute URL (`https://…`, `data:`) works:

```js
print: {
  coverUrl: 'https://example.com/images/cover.png'
}
```

Set it to `null`, `false` or `''` to explicitly disable the cover page (same as omitting it).

### `print.backUrl`

Adds a full-bleed image page at the end of the PDF (a "back cover"). **Optional** — when not set, no back page is inserted and the document ends after the last chapter. Like `coverUrl`, any relative path or absolute URL works:

```js
print: {
  backUrl: 'https://example.com/images/back.png'
}
```

Set it to `null`, `false` or `''` to explicitly disable the back page (same as omitting it).

> If the configured back image fails to load, the back page is left out automatically, so the PDF never contains a broken page. The back page (like the cover) gets no page-number footer.

### `print.chapterBreak`

How chapters start in the exported PDF:

| Value      | Behaviour                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| `'page'`   | **(default)** every chapter starts on a new page and may span several pages |
| `'onePage'`| every chapter is scaled down to fit on exactly one page (slide-deck style) |
| `'flow'`   | no page break — chapters flow continuously, content continues on the same page |

### `print.keepHeadingsWithNext`

Set this to `true` to prevent chapter and subchapter headings (`h1`–`h6`) from being left alone at the bottom of a page. If the block immediately after a heading does not fit in the remaining space, the heading and that block are moved together to the next page. Consecutive headings are kept together as a group.

```js
print: {
  chapterBreak: 'flow',
  keepHeadingsWithNext: true
}
```

Default: `false` (existing pagination behaviour is preserved unless this option is enabled). The option does not change the `'onePage'` mode, because that mode scales the complete chapter onto one sheet.

### List and table pagination

In the normal `'page'` and `'flow'` modes, long lists and tables are split automatically; no option is required:

- `<ul>` and `<ol>` split between top-level `<li>` elements. Nested lists stay with their parent item.
- Ordered-list numbering is preserved across continuation pages, including `start`, `value`, and `reversed` numbering.
- Tables split between rows in `<tbody>` and `<tfoot>`.
- An individual list item or table row is never split internally. If one is taller than a complete page, it remains intact and may overflow that page.
- With `keepHeadingsWithNext: true`, a heading is kept with the first list item or table row, not with the entire multi-page list or table.

### `print.repeatTableHeaders`

Set this to `true` to repeat a table's `<thead>` on every continuation page:

```js
print: {
  repeatTableHeaders: true
}
```

Default: `false`. The header remains on the table's first page but is not copied to continuation pages.

### `print.headingNumbers`

Set this to `true` to prepend hierarchical numbers to the table-of-contents rows **and** to the headings themselves:

```js
print: {
  headingNumbers: true
}
```

Chapters are numbered by their sidebar nesting: top-level chapters get `1.`, `2.`, `3.`, … and sidebar entries nested under them get `2.1`, `2.2`, …. Sub-headings inside each chapter's markdown file continue that hierarchy — `##` under chapter 2 becomes `2.1`, a `###` under that becomes `2.1.1`, and so on.

Default: `false` (headings are shown without numbers). The numbers are added only to the exported PDF, never to the on-screen docsify pages.

### `maxLevel` and `subMaxLevel`

The depth of the table of contents follows the standard Docsify settings in `index.html` (top level of `window.$docsify`, not inside `print`):

```js
window.$docsify = {
  loadSidebar: true,
  maxLevel: 4,
  subMaxLevel: 2
};
```

- `maxLevel` (default `4`) — the maximum nesting depth of TOC rows. Sidebar entries nested deeper are skipped entirely, and sub-headings are capped so their total depth never exceeds it.
- `subMaxLevel` (default `2`) — how many heading levels below the chapter title are listed from each markdown file: `2` lists `##` and `###`, `1` only `##`, `0` disables sub-headings (chapters only, as before).

## Page breaks inside a chapter

`print.chapterBreak` controls how whole chapters start. To also force a page break *inside* a chapter — e.g. to make a section start at the top of a new page — put one of these markers on its own line, between two blocks:

```markdown
<!-- page-break -->
```

or, equivalently:

```html
<div class="print-page-break"></div>
```

Both spellings do exactly the same thing: in the exported PDF, everything that follows the marker starts on a new page. The marker itself is invisible — both in the normal on-screen documentation and in the PDF.

Notes:

- The marker must be **block-level**: on its own line between blocks, not inside a paragraph, list item, table cell or blockquote. Markers nested inside such blocks are ignored.
- A page break **never creates a blank page**: consecutive markers count as one break, a marker at the very start of a chapter is a no-op, and a marker at the very end of the document is simply ignored.
- In `chapterBreak: 'flow'` mode, a marker at the end of a chapter also makes the *next* chapter start on a fresh page (the only way to break between chapters in flow mode).
- In `chapterBreak: 'onePage'` mode markers are ignored, because the whole chapter is scaled to fit on a single page.
- Text that looks like a marker inside a fenced code block is left untouched.

## How it works

1. Reads `_sidebar.md` to build the ordered chapter list (with nesting depth, capped by `maxLevel`).
2. Fetches every chapter's markdown file and renders it with `markdown-it` (images/links are absolutized so they survive in the standalone document), converts `<!-- page-break -->` markers into forced page breaks, and collects the file's sub-headings (up to `subMaxLevel`) for the table of contents.
3. Assembles a document: (optional) full-bleed cover (`print.coverUrl`) → table of contents → all chapters → (optional) full-bleed back cover (`print.backUrl`). If `coverUrl` or `backUrl` is not set, the corresponding page is left out and the page numbers adjust accordingly.
4. Paginates the content into explicit `210 × 297 mm` "sheets" (one sheet = one printed page) and places a real, absolutely positioned footer with the page number at the bottom-right of every page except the cover and the back cover (so without a cover, the TOC is page 1).
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
- **Broken images in the PDF** — if you configured `coverUrl`/`backUrl`, make sure the images exist and are reachable; a back image that fails to load is dropped automatically, and a missing cover simply means no cover page. Chapter images should use relative paths that resolve against the site URL.
