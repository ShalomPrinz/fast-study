# Merged PDFs

`/course/:course/merged` (`features/merged-pdfs/MergedPdfsView`) — a course's merged PDFs, newest first,
reached from the "Merged PDFs" secondary button under `CurrentStudy` on the overview. The create page
(`/course/:course/merged/new`, `ROUTES.mergedNew`, `mergedNewRoute`, `MergedNewView`) is below.

## Data

`fetchMergedPdfs` (`database.ts`) reads `GET /courses/{c}/merged`; `useMergedPdfs` refetches it on each SSE
notify, which the backend pings when a merge ends. `createMergedPdf` (`backend.ts`) is the `POST`; its 409
and 400 refusals throw coded like any other. `MergedPdf.name` is the sanitized file stem: every URL, the
bridge target (`{ course, merged: name }`) and the `/status` key use it, `title` is only shown.

## Run state

A merge appears in `/status` as `kind: 'merged'`, `lecture` = the file name, so it is a `StatusKind`, not a
`RunKind` (no retry, no queue). `mergedRows` derives each row's `MergedRun` from the one status the
`SnapshotProvider` already holds: `in_flight` with `waiting` is waiting for the course's merge lock, without
it running (a `ProgressBar` sized by `mergeInputBytes`, the parts' summed `summary.pdf` bytes; a first
creation has no stored parts, so it asks with 0), an `errors` record is failed (`ServiceError` under the
row). A run outranks the previous attempt's error. A run or error with no stored entry is its own row above
the history, titled by file name. The failure toast comes from `SnapshotProvider` (led by `MergedLead`), not
this page, so it shows on any page, once.

A running or waiting merge blocks a course rename and the data-root switch (`dataRootGuard`), like a lecture run.
A merge's `started_at` is when it took the course lock, so the `ProgressBar` never counts its wait. The backend
clears a name's previous error when a new merge of it is accepted, so a repeat failure toasts again (the
toast-once memory rearms on any status that lacks the key).

`RunnerView` and the header leave merged runs out (`isPipelineRun`); this page is where they show.
`isLectureRun` is lecture/recitation only.

## Row

Title, `created_at`, parts in merge order under their raw folder names (as the sidebar shows them; only the
PDF's bookmarks are Hebrew-translated), `missing` beside a part whose folder is gone, a "newer version
available" chip when `stale`. Open / Open with… (`canOpenWith()`) / Re-create. No delete anywhere.

## Hand-off to the create page

Re-create navigates to `mergedNewRoute(course)` with router state `MergedPrefill` (`features/merged-pdfs/types.ts`):
`{ title, parts: [{ name, kind }] }` in merge order.

## Create page

`MergedNewView`: a title (`#merged-title`, required), then `MergedPicker` at inline-start and `MergedOrder` at
inline-end (stacked under 640px of the page's own width, a container query), then "Merge PDFs"
(`.merged-create`, disabled while the title is blank, the order empty or a request is in flight).

- **Picker** lists the sidebar's tracks verbatim (`lectureTrack` / `recitationTrack`, so a lectures-only course
  is one merged list with one "select all"), parts by raw folder name. A part with no `summary.pdf` is a
  disabled `.merged-pick--missing` with a tooltip (a part already ticked stays enabled so it can be unticked,
  `checkboxDisabled`; one that vanishes from the tree is pruned from the order and named in the dropped note, `pruneVanished`); one whose PDF is older than `summary.md` (tree mtimes,
  `pdfState`) carries an "Outdated PDF" chip and stays tickable. "Select all" appends the unticked ones.
- **Order** is the ticked parts: ticking appends, unticking removes, drag reorders. Parts are keyed
  `kind:name` (`partKey`), since a lecture and a recitation may share a name.
- **Submit** posts `overwrite=false`; `submitAction` decides: `started`/`busy` go to the history,
  `merged_pdf_exists` opens the replace `ConfirmModal` (confirm re-sends with `overwrite=true`, cancel keeps the
  form), any other refusal toasts through `toastFailure`. The server's file name is unknown until the history
  lists it, so the submit never calls `markStarted`; the backend clears the old error on accept.
- **Re-create** reads `MergedPrefill` from `location.state` (`readPrefill`); `applyPrefill` keeps the parts still
  mergeable in their old order and the page names the rest in `.merged-note--dropped`.
- **Overwrite prompt** names the `merged_pdf_exists` `title` param, else the typed title (`existingTitle`).

All the rules above live in `utils/mergedSelection.ts`, tested without markup.

## Drag and drop

`@dnd-kit` (core, sortable, modifiers, utilities; pinned exactly). The whole row is the handle:
`PointerSensor` with a 200 ms hold and 5 px tolerance (`.merged-order-row--armed` tints the row while it
arms, `--dragging` is the dimmed slot, the lifted copy is a `DragOverlay` row, `--overlay`), `KeyboardSensor` with
`sortableKeyboardCoordinates` (Space lifts and drops, arrows move, Escape cancels). Modifiers are
`restrictToVerticalAxis` and `restrictToParentElement`. Rows are `touch-action: none` and `user-select: none`,
so a touch on a row drags rather than scrolls the list. The column body (`.merged-col-body`) scrolls on its own
and dnd-kit's auto-scroll drives it. Screen-reader announcements and instructions are Lingui strings.
