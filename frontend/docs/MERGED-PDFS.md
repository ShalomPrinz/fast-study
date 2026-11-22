# Merged PDFs

`/course/:course/merged` (`features/merged-pdfs/MergedPdfsView`) — a course's merged PDFs, newest first,
reached from the "Merged PDFs" secondary button under `CurrentStudy` on the overview. The create page
(`/course/:course/merged/new`, `ROUTES.mergedNew`, `mergedNewRoute`) is a separate piece.

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
