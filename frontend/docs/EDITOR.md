# Summary editor

`/:course/:lecture/edit` — `EditSummaryView`, outside `LecturesLayout` so it gets the full width.

## Layout

A toolbar — back (to the lecture page, never history, so a fresh tab stays in the app), the lecture name
(`dir="auto"`), the stale/warning PDF chip ([LECTURES.md](LECTURES.md) §summary.pdf badges), a demoted `Restore original` a gap away from the primary `Save & update PDF` — over
two panes: `PdfViewer` (zoom, current page, pop-out) and `MarkdownEditor`, headed by an amber
`Unsaved changes` dot whenever the buffer differs from what was last read or written.
Leaving the editor discards unsaved changes, with no confirm or `beforeunload`: an in-app guard needs
`useBlocker`, which only works under a data router, and moving off `<BrowserRouter>` is not worth it yet.

## Saving

`Save & update PDF` is the only write path — a saved summary whose PDF still shows the old text is never
what the user wanted. It runs save → delete `summary.pdf` → run `pdf`, then waits for SSE; the database
notifies on every summary write, so the stale chip's mtimes arrive the same way. It is enabled for a
dirty buffer, a stale PDF or no PDF — stale by the mtime rule (`pdfNeedsUpdate`), not the chip, which a
render warning outranks — and never for a blank buffer (`canUpdatePdf`), whose save would leave an empty
`summary.md` and delete a PDF the render cannot replace.
`Restore original` discards every edit and deletes the snapshot, so it is confirm-gated; a failure
(`summary.md` held open elsewhere) reports like a failed save, in the toolbar and as a toast.

The effect watching `files`/`lectureError` runs on every refresh, so `pdfFiredRef` limits it to the run
this view started: otherwise a sibling file change or another lecture's error would clear the generating
state, and the self-inflicted missing PDF would flash the "no PDF yet" placeholder. `PdfViewer`'s
`generating` wins over both, so one spinner covers the cycle.
`generating` is that local cycle or the runner reporting this lecture's `pdf` step (`pdfGenerating`), so a
reload mid-render keeps the spinner and the disabled Save; other steps in flight do not count.

## Changes from elsewhere

Another window's save, a restore or a re-summarize changes `summary.md`'s mtime on the SSE-refreshed tree,
and the editor re-reads the file. `diskChange` decides what that means: text equal to what the buffer was
read from is our own write echoing back; a clean buffer silently takes the new text; an edited one keeps
its text and raises a banner — load the new version, or keep the edits and save over it. `Save & update
PDF` is disabled until one is picked, so a buffer gone stale is never written over another writer's text
unasked.
Re-reads pause while our own save is in flight and run once after it: a notify can beat the PUT's
response, and comparing the new text against the pre-save one would flag our own write as a conflict.

## `PdfViewer`

The URL carries `t=<summary.pdf mtime>` (`utils/pdfUrl.ts`), so the cache is reused only while the file is
unchanged. react-pdf gets `{ url, httpHeaders }` so pdf.js's own XHR carries the launch secret, memoized
on `url` because react-pdf compares `file` by identity. Pop-out is an `onPopOut` callback that opens the
file through `services/open.ts`, rather than four more identifier props.

Scroll is captured during render, while the old pages are still mounted — when `generating` starts (its
spinner unmounts the scroll container before the new URL arrives) or when the URL changes — and restored
from each page's `onRenderSuccess`; with nothing captured it snaps to the right edge for RTL.

## `MarkdownEditor`

CodeMirror 6 composed extension by extension — no `basicSetup`, so no autocomplete, search, lint or line
numbers. It does install `history()` and `defaultKeymap` + `historyKeymap` (`@codemirror/commands`):
unbound, keys fall to contenteditable, whose Ctrl+Home/End only reach the lines CodeMirror has rendered.
A pushed `value` (load, Restore) stays out of undo history, so Ctrl+Z never brings discarded text back.
It is rich-styled _source_: markers stay in the buffer and the document is never re-serialized.
A `HighlightStyle` sizes headings, dims the markers to `--text-4`, and draws `---` as a chip, since exactly
two of them carry the document's structure.

`utils/mdDecorations.ts` scans the dialect as pure functions — pandoc `::: <class>` callouts, `$…$` /
`$$…$$` math, fenced code — and a `ViewPlugin` turns the ranges into decorations. Callout tints mirror
`LATEX_HEADER` in `backend/pipeline/to_pdf.py` ([why](../../backend/docs/BIDI.md#callout-boxes)); only `definition`/`warning`/`insight` get a box, so a typo
renders plain. Math carries `unicode-bidi: isolate`, without which an LTR run scrambles inside an RTL line;
a fenced block gets a line decoration instead, because the RTL base direction of a Hebrew line cannot be
undone from an inline span.

The text is Hebrew markdown, so it is set in the UI font, never monospace. **Direction is per line**: each
line with a letter carries `dir="auto"` (a line decoration) with `EditorView.perLineTextDirection` on, so a
title like `# Big-O בפייתון` reads LTR while the Hebrew lines under it stay RTL. A line with no letter
(blank, `---`, a table rule) inherits the content's `dir`: `rtl` once the document holds any Hebrew, else
`ltr`, so an English summary reads LTR throughout. The view is built
once and an incoming `value` is pushed only when it differs from `view.state.doc`, which stops the
editor's own edits echoing back.
