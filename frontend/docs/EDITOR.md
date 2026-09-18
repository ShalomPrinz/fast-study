# Summary editor

`/:course/:lecture/edit` — `EditSummaryView`, outside `LecturesLayout` so it gets the full width.

## Layout

A toolbar — back, the lecture name (`dir="auto"`), the stale/warning PDF chip ([LECTURES.md](LECTURES.md)
§summary.pdf badges), a demoted `Restore original` a gap away from the primary `Save & update PDF` — over
two panes: `PdfViewer` (zoom, current page, pop-out) and `MarkdownEditor`, headed by an amber
`Unsaved changes` dot whenever the buffer differs from what was last read or written.

## Saving

`Save & update PDF` is the only write path — a saved summary whose PDF still shows the old text is never
what the user wanted. It runs save → tree refresh (the stale chip reads the tree's mtimes) → delete
`summary.pdf` → run `pdf`, then waits for SSE. It is enabled for a dirty buffer, a stale PDF or no PDF.
`Restore original` discards every edit and deletes the snapshot, so it is confirm-gated.

The effect watching `files`/`lectureError` runs on every refresh, so `pdfFiredRef` limits it to the run
this view started: otherwise a sibling file change or another lecture's error would clear the generating
state, and the self-inflicted missing PDF would flash the "no PDF yet" placeholder. `PdfViewer`'s
`generating` wins over both, so one spinner covers the cycle.

## `PdfViewer`

The URL carries `t=<summary.pdf mtime>` (`utils/pdfUrl.ts`), so the cache is reused only while the file is
unchanged. react-pdf gets `{ url, httpHeaders }` so pdf.js's own XHR carries the launch secret, memoized
on `url` because react-pdf compares `file` by identity. Pop-out is an `onPopOut` callback that opens the
file through `services/open.ts`, rather than four more identifier props.

Scroll is captured during render, before the new URL commits (the old pages are still mounted), and
restored from each page's `onRenderSuccess`; with nothing captured it snaps to the right edge for RTL.

## `MarkdownEditor`

CodeMirror 6 composed extension by extension — no `basicSetup`, so no autocomplete, search, lint or line
numbers. It is rich-styled _source_: markers stay in the buffer and the document is never re-serialized.
A `HighlightStyle` sizes headings, dims the markers to `--text-4`, and draws `---` as a chip, since exactly
two of them carry the document's structure.

`utils/mdDecorations.ts` scans the dialect as pure functions — pandoc `::: <class>` callouts, `$…$` /
`$$…$$` math, fenced code — and a `ViewPlugin` turns the ranges into decorations. Callout tints mirror
`LATEX_HEADER` in `backend/pipeline/to_pdf.py` ([why](../../backend/docs/BIDI.md#callout-boxes)); only `definition`/`warning`/`insight` get a box, so a typo
renders plain. Math carries `unicode-bidi: isolate`, without which an LTR run scrambles inside an RTL line;
a fenced block gets a line decoration instead, because the RTL base direction of a Hebrew line cannot be
undone from an inline span.

The text is Hebrew markdown, so it is set in the UI font, never monospace, with `dir="auto"` through
`EditorView.contentAttributes` rather than a hard-coded `rtl` — English content exists. The view is built
once and an incoming `value` is pushed only when it differs from `view.state.doc`, which stops the
editor's own edits echoing back.
