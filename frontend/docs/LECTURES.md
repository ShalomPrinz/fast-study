# Lectures mode

The default sidebar mode plus the two lecture views (`MainView`, `EditSummaryView`).

## Pipeline steps are declared once

`constants/pipeline.ts` holds `PIPELINE` — the ordered `{ file, step, actionLabel, prereq }` chain
(video → audio → transcript → summary.md → summary.pdf → drive_url.txt) — and derives `STEP_FILE`,
`STEP_INPUT_FILE`, `STEP_LABEL`, `STEP_ERROR_LABEL`, `STEP_SET` from it. Never hard-code a step name,
its output file or its prerequisite anywhere else.

A step's button is enabled only when its prereq file exists and nothing is in flight for the lecture.
`transcript.partial.txt` present but `transcript.txt` missing relabels the action "Continue transcription".

## Rotate

Rotating a file deletes it _and every later file in `PIPELINE`_ that exists, then re-runs its step — the
confirm modal lists exactly those. This is why rotate must derive from the `PIPELINE` order rather than a
per-step list.

## Runner status and in-flight state

`RunnerStatusContext` (mounted in `Layout`) holds the whole runner picture from `GET /status`, refreshed on
mount and on every SSE notify — never polled:

```ts
{ runner: { running, total, done, lastError }, inFlight: InFlightEntry[], errors: Record<skey, string> }
```

`inFlight` covers active steps from _any_ trigger (runner sweep, `/pipeline`, single `/run/{step}`);
`errors` persists a lecture's last failure after the entry leaves `inFlight`. Keys are
`course||lecture||kind` (`shared/utils/inFlightKey.ts`) and **must mirror backend `runner.py::_skey`**.
`runner.lastError` is an unexpected exception that aborted a sweep, distinct from the expected per-step
failures in `errors`.

Error toasts fan out through `useReportOnce`, which dedupes `(key, message)` so a repeated refresh doesn't
re-toast, and `prune(validKeys)` lets a key fire again if the same error recurs later.

`useRemoteInflightState` turns the entry for the currently open lecture into a render descriptor: step,
start time, timing estimate, `completedFraction`, `sleepingUntil`, `progress`. Progress comes from the
entry when present, else from `transcript.partial.txt`'s completed/total for a transcribe step.

`useTimingStats(step, fileSizeBytes)` fetches the backend's linear-regression estimate for the step's
_input_ file size and drops responses for a `(step, size)` key the caller has moved on from.

Rate limiting is not an error: when the runner sets `sleepingUntil`, `MainView` renders a countdown panel
with the chunk progress instead of a failure.

## Edit summary view

Save → delete `summary.pdf` → run the `pdf` step, then wait for SSE. The effect that watches
`files`/`lectureError` runs on every refresh, so a `pdfFiredRef` gate limits the completion branch to the
run this view started — otherwise a sibling file change or another lecture's error would clear the
generating state. The PDF is re-rendered by bumping a cache-busting `t=` on the file URL.

This is the one caller passing `resetHistory: false` to `runStep` (`reset_history=false` on the wire). The
backend's `pdf` step otherwise deletes `original_summary.md` + `summary.pdf` first, and this save just
created that snapshot — the flag is what keeps "Revert to Original" working. A PDF export from `MainView`
(Export PDF, or the ↺ re-run) takes the default and wipes the history on purpose.

`PdfViewer` captures scroll during the render phase before React commits the new URL (the old pages are
still mounted, so `scrollTop` is the real position) and restores it from each page's `onRenderSuccess`;
with no captured position it snaps to the right edge for RTL.

## Sidebar tree

State ownership is deliberate:

- `CourseTreeContext` owns `courses` + `refreshCourses`, refreshes on SSE notify, and sorts each course's
  lectures/recitations through `sortLectures`. Everything reads it directly — no props, no outlet context.
  `useLectureRoute` derives the open lecture's `files`/`transcribePartial` from it plus the route params.
- `CourseGroup` owns both `expanded` and `recExpanded` and passes 1-prop `ExpandHandle`s down, so the
  recitations sub-group's open state survives collapsing and re-expanding the course. It auto-expands once
  the first time it becomes the selected course (deep links).
- `CourseGroupContext` carries `{ course, add }` and `LectureListContext` carries just `kind`, so the
  recursive rows reach them without prop-drilling. `AddLectureInput` renders only in the list whose kind is
  being added, so the two lists never show an input at once.

Interaction conventions: shift-click a course or lecture row renames it inline; holding shift swaps the
course "+" button for archive/unarchive. `useShiftHeld` resets on window blur because an alt-tab mid-hold
never delivers `keyup`.

`PaginatedList` slices from the _tail_ so newly added items stay visible, with a "Load more" row above that
reveals older items in doubling chunks.

## Name suggestion and sorting

`namingSuggestion.ts` suggests the next name from what the course already has: `Lecture N+1`, except that a
trailing `Lecture N.1` suggests `Lecture N.2` (a split session's second half). Recitations are plain
`Recitation N+1`.

`lectureSort.ts` orders by parsed `(number, sub-number)` from `Lecture|Recitation N[.M]`; unparsed names
sort to the head, then alphabetically among themselves.
