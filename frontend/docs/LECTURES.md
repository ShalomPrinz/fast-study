# Lectures mode

The sidebar, the lectures tree pane and the lecture page (`MainView`). The summary editor is
[EDITOR.md](EDITOR.md).

## Pipeline steps are declared once

`constants/pipeline.ts`'s `PIPELINE` is the ordered chain (video → audio → transcript → summary.md →
summary.pdf → drive_url.txt); `STEP_FILE`, `STEP_INPUT_FILE`, `STEP_LABEL` and friends derive from it.
Never hard-code a step name, its output file or its prerequisite elsewhere.

`visiblePipeline(driveEnabled, files)` drops the Drive stage with Drive off, matching the backend, which
rejects `run/drive` then; a lecture uploaded while Drive was on keeps the row so its link stays reachable.
`stepPosition` numbers a step among the visible _steps_ — `video.mp4` is the input, not a step — so the
lecture header's "step 2 of 5" and the runner rail's chip agree.

Three `msg` label sets: `stageLabel` names the stage pending or done, `runningLabel` replaces it only in
flight, `actionLabel` is the button. There is deliberately no past-tense form. A step's button needs its
prereq file and nothing in flight for the lecture; `transcript.partial.txt` without `transcript.txt`
relabels it "Continue transcription".

## The lecture view

`MainView` is a `PageHeader` (course eyebrow, lecture title, running step or `Complete`, video duration
when the MP4 header yields one, material count, the single primary `Run Remaining`, offered only when
`canRunRemaining` says the backend's `next_step` exists and can start) over one
`.pipeline-card` holding all stages as rows parted by inset rules. The per-file actions — edit summary,
open PDF, open in Drive, each once its file exists — sit on a second header row, keeping them off a title
column with no width floor. Below 960px `useCompactHeaderActions` (one `matchMedia` on window width; the
content pane is always the window less 536) folds them into `LectureActionsMenu`, a ⋮ left of
`Run Remaining` so the primary button never moves.
Completion is carried by the `StatusNode` alone, never a row tint; the running row sits on
`--surface-sunken` with `ProgressBar`'s ETA at the end of the stage line.
A missing file whose step is the lecture's `error.step` shows `failed`, or `quota` for a Gemini quota
code (`utils/stepState.ts`); the row's `data-status` carries the same state.

**Rotate** deletes a file _and every later file in `PIPELINE`_ that exists, then re-runs its step — why
it derives from `PIPELINE` order rather than a per-step list. A refused delete (`file_locked`, the file open in the
user's PDF app) toasts and stops before the step, which would only hit the same lock; the editor's
re-export and a material delete share the guard.

A provider quota or rate limit is an error like any other: `gemini_quota_*` and `groq_rate_limit*` codes
(`isQuotaError`) mark the step with the quota glyph, and a `blocked` record is not toasted again per lecture.

## Materials

A lecture holds any number of `material[.N].pdf`, carried on the tree entry as `materials` beside `files`.
They are summarize inputs, not stages, so they render as chips under their own heading, opened and deleted
**by name**; a delete never renames the rest, so indices gain gaps and held URLs stay valid.

`materialIndicator` drives the Summary row's chip: before a summary, `no material found` / `will be
used`; after, each material's mtime against the summary's picks all used (green), none used (grey), or
`N of M` (amber), and a summary made with no materials gets no chip. **mtime is a proxy for "was fed to
the model", not a record** — re-downloading an unchanged PDF reads as unused. Exactness would need the
backend to persist each run's inputs.

## Runner status and in-flight state

`RunnerStatusContext` holds `GET /status`, refreshed by `SnapshotProvider` (in `Layout`) on mount and
every notify together with the tree, never polled. `inFlight` covers active steps from any trigger;
`errors` keeps a lecture's last failure after it leaves; `runner.lastError` is an exception that aborted a sweep, distinct from per-step failures. Keys are
`course||lecture||kind` (`shared/utils/inFlightKey.ts`) and **must mirror `_skey` in
`backend/pipeline/runner.py`**. `/running` is the whole surface for the queue, the in-flight entries and
the lectures nothing will pick up; the sidebar row reads only `runner` for its badge.
On `/running` an in-flight row is one link to its lecture. A waiting row's text acts instead, and only its
trailing icon opens the lecture. A not-queued row shows `failed` or `quota` from `errors` (pending otherwise) and runs its pipeline beside the runner, and a queued one
moves to the front (the head row's text is inert). Either way the reorder arrives over SSE.

`errors` maps each key to `{ step, message, code, params, provider, blocked }`. The "Last error" box and
the toast both render it through `ServiceError` ([I18N.md](I18N.md)), the toast led by `LectureLead`, the lecture and course
`parseInFlightKey` reads off the key, since it shows on any page; `isQuotaError` (`utils/runError.ts`)
tests the four quota codes (two Gemini, two Groq) `backend/pipeline/runner.py` spells, which is also what marks the row's glyph.

Error toasts go through `useReportOnce`, which dedupes `(key, failureId)` across refreshes; `prune` lets a
key fire again if the error recurs. A quota toasts only when not `blocked` — the lecture that hit the limit,
not each one run-all then stopped at summarize.

`useRemoteInflightState` turns the open lecture's entry into a render descriptor; progress comes from the
entry, else from `transcript.partial.txt` for a transcribe step. `useTimingStats(step, bytes)` fetches the
backend's regression estimate for the step's _input_ size and drops answers for a key the caller left.

## summary.pdf badges

`pdfBadge(files)` picks **one** badge for `summary.pdf`: a render warning (⚠) if any, else stale (≠) when
`summary.md` is newer. The warning wins because it describes _this_ PDF. `MainView` shows it on the row;
the editor toolbar spells it out as a chip. A **missing** PDF is never stale — every re-render path deletes
`summary.pdf` first, which keeps a pending re-render quiet — and equal mtimes don't warn.

A render warning is the database service's `.pdf_warning` inlined onto the tree's `FileInfo`. It lives on
the tree, not `/status`, so it is announced as each tree applies (`announcePdfWarnings`): the first tree only
seeds, and a vanished warning is pruned so it can fire again. Deleting `summary.pdf` drops the dotfile
server-side, so no frontend path clears it.

## Sidebar

The brand, then five route rows — Lectures, Running pipelines, Downloads, Search, Settings — exactly one
active per page ([ARCHITECTURE.md](ARCHITECTURE.md) §Routes). Running pipelines shows `current/total`
while the runner is on; Downloads counts running jobs. Every glyph is inline SVG from `Icon`.

The footer is `UpdateRow` above a row with `LanguageSwitcher` at the inline start and the version tag at the
end — the bridge's `version` when `packaged`, else `dev`. `UpdateRow` follows the launcher's update phase
(`hooks/useAppUpdate.ts`: a snapshot, then pushes; hidden for `null` and without the bridge):
`downloading` is a spinner, `downloaded` offers Restart now. That asks first while the runner or a download
runs, then grays the window until the app quits; a refusal that arrives drops the gray
([electron/docs/UPDATES.md](../../electron/docs/UPDATES.md)).

Lectures reopens the last lecture page `LecturesLayout` showed (`utils/lastLecture.ts`, never the overview
page) while the tree still has it, else `/`.

## Tree pane

`LecturesTreePane` renders beside `/`, the overview and `/:course/:lecture` only. It holds the active
`CourseGroup`s, `ArchivedSection` and `New course`, inside `PendingUploadProvider` so an mp4 dropped on a
lecture row can prompt. With no course at all after a successful load (`isTreeEmpty`, archived courses count) the nav shows a centred `.tree-pane-empty` note pointing at Downloads and `New course`; a failed load (`loadFailed`) never shows it. An expanded course opens with an Overview row; the course header only toggles.

`utils/lectureProgress.ts`: `isLectureComplete` (the last pipeline output exists, mirroring the backend's
`final_output()`, whatever earlier file is gone) colours each lecture's dot and reads `Complete` on its page; `courseProgress` gives the header's `N/M`, `0/0` for an
archived course so the badge stays off.

- `CourseTreeContext` exposes `courses`, `loaded`, `loadFailed` and `refreshCourses`; `SnapshotProvider` fills it, refreshing
  on notify together with `/status`, and sorts courses by name (`localeCompare`) and their lectures through
  `sortLectures`. Everything reads it directly, no props
  or outlet context.
- `CourseGroup` owns `expanded` and `recExpanded`, so the recitations sub-group survives collapsing the
  course. It auto-expands when one of its lectures or its overview is the open route (deep links).
- The pane unmounts on other routes; only each course's expansion (a module map in
  `utils/courseExpansion.ts`, moved to the new name on a course rename) and the nav's scroll position
  survive, the latter saved on each scroll because a detached nav reads 0. The auto-expand re-runs on
  remount: keeping the open page's course visible deliberately beats restoring an explicit collapse.
- `CourseGroupContext` and `LectureListContext` reach the recursive rows without prop-drilling;
  `AddLectureInput` renders only in the list being added to.
- New course/lecture/recitation inputs stay open with the typed text until the create succeeds
  (`useCreateAttempt`): `CreateStatus` shows "Creating…" and blocks a second submit, then the refusal in place.

Shift-click renames a row inline; holding shift swaps a course's "+" for archive/unarchive. A running
or queued lecture, and a course holding one, a generating overview (`/status`'s `overview_running`) or a
non-terminal download job or a `running`/`paused` section run (`useCourseDownloading`, extension jobs
included), refuse the rename
(`utils/renameLock.ts`): each writes by the name it was given, so a mid-run rename splits the lecture in two.
A running or queued lecture refuses a video drop too, checked again on the replace confirm: the upload wipes
the folder under a run that would finish from the old video. The replace confirm lists audio, transcript, summary and PDF and says materials are kept; it leaves out `drive_url.txt`, which the wipe also removes (the Drive file itself is never deleted, so only the local link, and "Open in Drive" with it, goes). An open page — lecture or overview — follows the
name the rename answers, since the database may sanitize the typed one, in the render of the first tree that
holds it — usually the database's own notify, which lands before the rename's refetch does — through
`refreshUntil`, which falls back to that refetch settling. The row shows the new name from Enter until then
(`utils/renameFlow.ts`). `useShiftHeld`
resets on window blur, because an alt-tab mid-hold never delivers `keyup`.

`nextName.ts` suggests `<prefix> N+1`, except a trailing `N.1` suggests `N.2` (a split session's second
half); recitations have no sub-sessions ([I18N.md](I18N.md) for the prefix). `lectureSort.ts` orders by
`(number, sub-number, name)` parsed with the same any-prefix regex; unparsed names sort first, alphabetically.
