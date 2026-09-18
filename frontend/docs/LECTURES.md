# Lectures mode

The sidebar, the lectures tree pane and the lecture page (`MainView`). The summary editor is
[EDITOR.md](EDITOR.md).

## Pipeline steps are declared once

`constants/pipeline.ts`'s `PIPELINE` is the ordered chain (video → audio → transcript → summary.md →
summary.pdf → drive_url.txt); `STEP_FILE`, `STEP_INPUT_FILE`, `STEP_LABEL` and friends derive from it.
Never hard-code a step name, its output file or its prerequisite elsewhere.

`visiblePipeline(driveEnabled, files)` drops the Drive stage with Drive off, matching the backend, which
rejects `run/drive` then; a lecture uploaded while Drive was on keeps the row so its link stays reachable.

Three `msg` label sets: `stageLabel` names the stage pending or done, `runningLabel` replaces it only in
flight, `actionLabel` is the button. There is deliberately no past-tense form. A step's button needs its
prereq file and nothing in flight for the lecture; `transcript.partial.txt` without `transcript.txt`
relabels it "Continue transcription".

## The lecture view

`MainView` is a `PageHeader` (course eyebrow, lecture title, running step or `Complete`, video size,
material count, the single primary `Run Remaining`, and a `LectureActionsMenu` overflow for edit summary,
open PDF and open in Drive) over one `.pipeline-card` holding all stages as rows parted by inset rules.
Completion is carried by the `StatusNode` alone, never a row tint; the running row sits on
`--surface-sunken` with `ProgressBar`'s ETA at the end of the stage line.
A missing file whose step is the lecture's `error.step` shows `failed`, or `quota` for a Gemini quota
error (`utils/stepState.ts`); the row's `data-status` carries the same state.

**Rotate** deletes a file _and every later file in `PIPELINE`_ that exists, then re-runs its step — why
it derives from `PIPELINE` order rather than a per-step list. A refused delete (`423`, the file open in the
user's PDF app) toasts and stops before the step, which would only hit the same lock; the editor's
re-export and a material delete share the guard.

Rate limiting is not an error: with `sleepingUntil` set, the view shows a countdown with the chunk
progress instead of a failure.

## Materials

A lecture holds any number of `material[.N].pdf`, carried on the tree entry as `materials` beside `files`.
They are summarize inputs, not stages, so they render as chips under their own heading, opened and deleted
**by name**; a delete never renames the rest, so indices gain gaps and held URLs stay valid.

`materialIndicator` drives the Summary row's chip: before a summary, `no material found` / `will be
used`; after, each material's mtime against the summary's picks all used (green), none used (grey), or
`N of M` (amber). **mtime is a proxy for "was fed to the model", not a record** — re-downloading an
unchanged PDF reads as unused. Exactness would need the backend to persist each run's inputs.

## Runner status and in-flight state

`RunnerStatusContext` (in `Layout`) holds `GET /status`, refreshed on mount and every notify, never
polled. `inFlight` covers active steps from any trigger; `errors` keeps a lecture's last failure after it
leaves; `runner.lastError` is an exception that aborted a sweep, distinct from per-step failures. Keys are
`course||lecture||kind` (`shared/utils/inFlightKey.ts`) and **must mirror `_skey` in
`backend/pipeline/runner.py`**. `/running` is the whole surface for the queue, the in-flight entries and
the lectures nothing will pick up; the sidebar row reads only `runner` for its badge.

`errors` maps each key to `{ step, message, code, provider }`; `code: 'quota'` marks Gemini's exhausted
daily quota, set on every lecture a run-all stopped at summarize for it, and the "Last error" box then
leads with a localized headline above the backend's prose.

Error toasts go through `useReportOnce`, which dedupes `(key, message)` across refreshes; `prune` lets a
key fire again if the error recurs. A quota error toasts the localized line instead, and only when not
`blocked` — the lecture that hit the limit, not each one run-all then stopped at summarize.

`useRemoteInflightState` turns the open lecture's entry into a render descriptor; progress comes from the
entry, else from `transcript.partial.txt` for a transcribe step. `useTimingStats(step, bytes)` fetches the
backend's regression estimate for the step's _input_ size and drops answers for a key the caller left.

## summary.pdf badges

`pdfBadge(files)` picks **one** badge for `summary.pdf`: a render warning (⚠) if any, else stale (≠) when
`summary.md` is newer. The warning wins because it describes _this_ PDF. `MainView` shows it on the row;
the editor toolbar spells it out as a chip. A **missing** PDF is never stale — every re-render path deletes
`summary.pdf` first, which keeps a pending re-render quiet — and equal mtimes don't warn.

A render warning is the database service's `.pdf_warning` inlined onto the tree's `FileInfo`. It lives on
the tree, not `/status`, so `CourseTreeContext` announces it (`announcePdfWarnings`): the first tree only
seeds, and a vanished warning is pruned so it can fire again. Deleting `summary.pdf` drops the dotfile
server-side, so no frontend path clears it.

## Sidebar

The brand, then five route rows — Lectures, Running pipelines, Downloads, Search, Settings — exactly one
active per page ([ARCHITECTURE.md](ARCHITECTURE.md) §Routes). Running pipelines shows `current/total`
while the runner is on; Downloads counts running jobs. The footer holds `LanguageSwitcher`; every glyph is
inline SVG from `Icon`.

Lectures reopens the last lecture page `LecturesLayout` showed (`utils/lastLecture.ts`, never the overview
page) while the tree still has it, else `/`.

## Tree pane

`LecturesTreePane` renders beside `/`, the overview and `/:course/:lecture` only. It holds the active
`CourseGroup`s, `ArchivedSection` and `New course`, inside `PendingUploadProvider` so an mp4 dropped on a
lecture row can prompt. An expanded course opens with an Overview row; the course header only toggles.

`utils/lectureProgress.ts`: `isLectureComplete` (the last pipeline output exists, mirroring the backend's
`final_output()`) colours each lecture's dot; `courseProgress` gives the header's `N/M`, `0/0` for an
archived course so the badge stays off.

- `CourseTreeContext` owns `courses`, `loaded` and `refreshCourses`, refreshes on notify and sorts through
  `sortLectures`; everything reads it directly, no props or outlet context.
- `CourseGroup` owns `expanded` and `recExpanded`, so the recitations sub-group survives collapsing the
  course. It auto-expands when one of its lectures or its overview is the open route (deep links).
- The pane unmounts on other routes; only each course's expansion (a module map in `CourseGroup.tsx`) and
  the nav's scroll position survive, the latter saved on each scroll because a detached nav reads 0. The
  auto-expand re-runs on remount: keeping the open page's course visible deliberately beats restoring an
  explicit collapse.
- `CourseGroupContext` and `LectureListContext` reach the recursive rows without prop-drilling;
  `AddLectureInput` renders only in the list being added to.

Shift-click renames a row inline; holding shift swaps a course's "+" for archive/unarchive. `useShiftHeld`
resets on window blur, because an alt-tab mid-hold never delivers `keyup`.

`nextName.ts` suggests `<prefix> N+1`, except a trailing `N.1` suggests `N.2` (a split session's second
half); recitations have no sub-sessions ([I18N.md](I18N.md) for the prefix). `lectureSort.ts` orders by
parsed `(number, sub-number)`; unparsed names sort first, alphabetically.
