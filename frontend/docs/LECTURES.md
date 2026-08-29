# Lectures mode

The default sidebar mode plus the two lecture views (`MainView`, `EditSummaryView`).

## Pipeline steps are declared once

`constants/pipeline.ts` holds `PIPELINE` — the ordered
`{ file, stageLabel, step, runningLabel, actionLabel, prereq }` chain
(video → audio → transcript → summary.md → summary.pdf → drive_url.txt) — and derives `STEP_FILE`,
`STEP_INPUT_FILE`, `STEP_LABEL`, `STEP_ERROR_LABEL`, `STEP_SET` from it. Never hard-code a step name,
its output file or its prerequisite anywhere else.

`visiblePipeline(driveEnabled, files)` is what a lecture actually renders: with Drive off it drops the
Drive stage, matching the backend, which rejects `run/drive` and ends the pipeline at `summary.pdf`. A
lecture uploaded while Drive was on keeps the row, so its `drive_url.txt` stays reachable.

Three label sets, all `msg` descriptors resolved at the render site: `stageLabel` names the stage
(`Video`, `Audio`, `Transcript`, …) whether it is pending or done, `runningLabel` replaces it only while
the step is in flight (`Extracting audio`, `Transcribing`, …), and `actionLabel` is the button that
starts it. There is deliberately no past-tense fourth form — a done row reuses `stageLabel`.

A step's button is enabled only when its prereq file exists and nothing is in flight for the lecture.
`transcript.partial.txt` present but `transcript.txt` missing relabels the action "Continue transcription".

## The lecture view

`MainView` is a `PageHeader` band above one scrolling body. The header carries the course as eyebrow,
the lecture name as title, a metadata row (running step or `Complete`, video size, material count),
and the page's single primary button, `Run Remaining`, beside a `LectureActionsMenu` overflow holding
the per-file actions — edit summary, open PDF, open in Drive — that no longer sit on their rows.

Below it, `.pipeline-card` (shared with the course overview, in `styles/pipeline-card.css`) is **one**
bordered card holding all six stages, parted by rules inset to
clear the status column, not six boxes. Each row is a `StatusNode`, the stage name, and the raw
filename plus size as a monospace subtitle; completion is carried by the node alone, never by tinting
the row. The running row sits on `--surface-sunken`, swaps in `runningLabel`, and lays its body out as
a grid so `ProgressBar`'s own ETA label lands at the end of the stage line with the track beneath.

## Rotate

Rotating a file deletes it _and every later file in `PIPELINE`_ that exists, then re-runs its step — the
confirm modal lists exactly those. This is why rotate must derive from the `PIPELINE` order rather than a
per-step list.

## Materials

A lecture holds any number of materials — `material.pdf`, `material.2.pdf`, … — carried on the tree entry
as `materials: {name, size, mtime}[]` beside `files` (always present, `[]` when none, index order). They
are summarize inputs rather than pipeline outputs, so `MainView` shows them as a row of outlined chips
under their own "Materials" heading rather than as stages — the chip's name opens the file and its trash
button deletes it, both **by name** via the per-file routes. Deleting one never renames the others, so a
held URL stays valid and the indices simply gain gaps.

`materialIndicator(materials, summaryExists, summaryMtime)` (pure, in `utils/`) drives the chip on the
Summary row. With no summary yet: `no material found`, or `will be used`. With a summary, each material's
mtime is compared against it and the counts pick the state — all older → `was used` (green), none older →
`did not use any material` (grey; a lone material is named instead of counted), and in between →
`summary used only N of M materials` (amber, milder than a total miss). The copy names a single material
and counts several throughout. The chip carries the text and the colour.

**mtime is a proxy for "was fed to the model", not a record of it.** Re-downloading an unchanged PDF bumps
its mtime and so reads as unused, and the partial count inherits that fuzziness. Being exact would need the
backend to persist which materials each summarize run consumed; until it does, the indicator is a hint, not
an audit.

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

`app/AutoRunOnBoot` fires the context's `trigger` once when the app comes up, gated on the
`autoRunOnBoot` preference — shipped **on**, so a fresh profile starts every pending pipeline at boot.
`RunnerPipelineRow` — the "Run incomplete pipelines" button and the in-flight panel below it — renders
nothing at all when `runnerControlsVisible` is off, which is the shipped default. Both preferences live
in `shared/utils/uiPreferences.ts`; see `SETTINGS.md`.

Error toasts fan out through `useReportOnce`, which dedupes `(key, message)` so a repeated refresh doesn't
re-toast, and `prune(validKeys)` lets a key fire again if the same error recurs later.

## summary.pdf badges

`PdfWarningBadge` (shared — the course overview reuses it) renders the badge it is handed. For
`summary.pdf` that badge is **one** of, chosen by `pdfBadge(files)`: a render warning
(⚠) if there is one, else a stale marker (≠) when `summary.md` has a newer `mtime` than `summary.pdf`.
The warning wins because it describes _this_ PDF; staleness resurfaces on its own once it clears. It
appears on the `summary.pdf` row in `MainView`; the `EditSummaryView` toolbar spells the same
`pdfBadge(files)` out as a `--warn` chip, since its preview pane would otherwise show the outdated
render with no hint and the toolbar has room for the sentence.

Staleness means the PDF no longer reflects the summary — after a revert, an edit that never regenerated,
or a re-run `summarize`. A **missing** PDF is never stale, which is what keeps a pending re-render quiet:
every path that re-renders (rotate, edit-view re-export) deletes `summary.pdf` first, and a fresh pipeline has
not written one yet. Equal mtimes don't warn, so a same-second render can't flicker.

### Render warnings

A `summary.pdf` that rendered despite XeLaTeX errors carries a one-line `warning` on its `FileInfo` (the
database service inlines the `.pdf_warning` dotfile onto the tree entry; the key is absent when clean).
It is non-fatal, message on hover, and `CourseTreeContext` announces it once through `useReportOnce` +
`announcePdfWarnings`: the first applied tree only seeds, so warnings predating page load don't toast,
and a vanished warning is pruned so it can fire again. It lives on the tree, not `/status`, which is why
it is announced there and not in
`RunnerStatusContext`. Deleting `summary.pdf` (rotate, edit-view re-export) drops `.pdf_warning` inside the
database service, so no frontend path clears it.

`useRemoteInflightState` turns the entry for the currently open lecture into a render descriptor: step,
start time, timing estimate, `completedFraction`, `sleepingUntil`, `progress`. Progress comes from the
entry when present, else from `transcript.partial.txt`'s completed/total for a transcribe step.

`useTimingStats(step, fileSizeBytes)` fetches the backend's linear-regression estimate for the step's
_input_ file size and drops responses for a `(step, size)` key the caller has moved on from.

Rate limiting is not an error: when the runner sets `sleepingUntil`, `MainView` renders a countdown panel
with the chunk progress instead of a failure.

## Edit summary view

A toolbar over two labelled panes. The toolbar runs: back, a rule, the lecture name (`dir="auto"`), the
stale/warning PDF chip, then `Revert to original` and `Re-export PDF` as ghosts beside the primary `Save`.
The left pane heads its PDF with `Current PDF`, the zoom controls, the page under the middle of the
viewport and an open-in-new-tab button; the right pane heads the plain `<textarea>` with `summary.md` and,
whenever the buffer differs from what was last read or written, an amber `Unsaved changes` dot. The editor
holds Hebrew markdown, so it is set in the UI font with wide leading, never monospace.

`Save` writes `summary.md` and asks for a tree refresh, because the write leaves `summary.pdf` behind and
the chip that says so reads tree mtimes. `Re-export PDF` is the older, longer path and still saves first:
save → delete `summary.pdf` → run the `pdf` step, then wait for SSE. The effect that watches
`files`/`lectureError` runs on every refresh, so a `pdfFiredRef` gate limits it to the run this view
started — otherwise a sibling file change or another lecture's error would clear the generating state,
and the self-inflicted missing PDF mid-run would flash the "no PDF yet" placeholder. `PdfViewer`'s
`generating` prop wins over both the placeholder and the document, so one spinner covers the whole cycle.
The file URL carries `t=<summary.pdf mtime>` (`utils/pdfUrl.ts`), so the browser cache is reused only
while the file on disk is unchanged.

`PdfViewer` captures scroll during the render phase before React commits the new URL (the old pages are
still mounted, so `scrollTop` is the real position) and restores it from each page's `onRenderSuccess`;
with no captured position it snaps to the right edge for RTL.

## Sidebar

`Sidebar` opens with the brand, then four nav rows — Lectures, Courses, Downloads, Search. Downloads
and Search are routes; Lectures and Courses swap the tree body below and own that choice themselves,
persisted under `localStorage['fastStudyMode']` (the key the segmented `ModeToggle` they replaced used,
so an existing choice carried over). A route row outranks the tree rows for the active highlight.
Downloads carries a badge counting running jobs, read off `DownloadJobsContext`. The footer holds
`New course` and `LanguageSwitcher`; every glyph in the sidebar is inline SVG from `Icon`.

`utils/lectureProgress.ts` feeds the tree's two progress signals: `isLectureComplete` (the last
pipeline output existing — `drive_url.txt`, or `summary.pdf` with Drive off, mirroring the backend's
`final_output()`) gives each lecture row its leading dot, green when
complete, accent while a step of it is in flight, hollow otherwise; `courseProgress` gives each course
header its right-aligned `N/M`, lectures and recitations together, and returns `0/0` for an archived
course so the badge stays off there.

## Sidebar tree

State ownership is deliberate:

- `CourseTreeContext` owns `courses` + `loaded` + `refreshCourses`, refreshes on SSE notify, and sorts each
  course's lectures/recitations through `sortLectures`. Everything reads it directly — no props, no outlet
  context. `useLectureRoute` derives the open lecture's `files`/`transcribePartial` from it plus the route
  params.
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

`nextName.ts` suggests the next name from what the course already has: `Lecture N+1`, except that a
trailing `Lecture N.1` suggests `Lecture N.2` (a split session's second half). Recitations are plain
`Recitation N+1`.

`lectureSort.ts` orders by parsed `(number, sub-number)` from `Lecture|Recitation N[.M]`; unparsed names
sort to the head, then alphabetically among themselves.
