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
when the MP4 header yields one, material count, the `StudyDoneButton` toggle, the single primary `Run Remaining`, offered only when
`canRunRemaining` says the backend's `next_step` exists and can start) over one
`.pipeline-card` holding all stages as rows parted by inset rules. The per-file actions — edit summary,
open PDF, open in Drive, each once its file exists — sit on a second header row, keeping them off a title
column with no width floor. Below 960px `useCompactHeaderActions` (one `matchMedia` on window width; the
content pane is always the window less 536) folds them into `LectureActionsMenu`, a ⋮ left of
`Run Remaining` so the primary button never moves.
Completion is carried by the `StatusNode` alone, never a row tint; the running row sits on
`--surface-sunken` with `ProgressBar`'s ETA at the end of the stage line.
`ProgressBar` keeps its track in every state — the whole track pulsing in the accent while estimating, flat gray with
no estimate — so a host never changes height when the stats arrive; the real fill then grows from 0.
A missing file whose step is the lecture's `error.step` shows `failed`, or `quota` for a Gemini quota
code (`utils/stepState.ts`); the row's `data-status` carries the same state.

`StudyDoneButton` marks the lecture studied (`--info`, "Done"); once done it turns `--success` with a ✓ and a
tooltip saying a click reverts it. Done is manual and independent of the pipeline, so it is always enabled.

**Rotate** deletes a file _and every later file in `PIPELINE`_ that exists, then re-runs its step — why
it derives from `PIPELINE` order rather than a per-step list. A refused delete (`file_locked`, the file open in the
user's PDF app) toasts and stops before the step, which would only hit the same lock; a material delete
shares the guard. The editor's re-export instead runs `pdf` with `fresh=true`, so the delete happens under the lecture lock.

A provider quota or rate limit is an error like any other: `gemini_quota_*` and `groq_rate_limit*` codes
(`isQuotaError`) mark the step with the quota glyph, and a `blocked` record is not toasted again per lecture.

## Materials

A lecture holds any number of `material[.N].<ext>` of any file type, carried on the tree entry as `materials`
beside `files`. They are summarize inputs, not stages, so they render as `MaterialChip`s under their own
heading, opened and deleted **by name**; a delete never renames the rest, so indices gain gaps and held URLs
stay valid. A chip shows `displayName` (the sidecar's original `filename`, else the disk name) everywhere
the material is named, and holds, in order: the name button (OS default app; `MaterialNameButton` is the
reusable piece), the **attach switch**, "Open with…" in an `OpenWithMenu` overflow, and delete.

**Attach.** The switch decides whether Summarize sends the material to Gemini (`setMaterialAttach`; the tree's
SSE refresh brings the new state). It is disabled while a run is on the lecture, until the support set
loads, and for a type Gemini can't read. "Open with…" shows only where `canOpenWith()` (bridge has
`open.fileWith` and `platform === 'win32'`). A material that is not sent reads muted; an attached one over
10 MB (`MAX_GEMINI_FILE_BYTES`, mirroring the backend's) shows a warning, since Summarize would fail.

**Support set.** `GET /materials/supported` is read once after load (`app/supportedMaterials.ts`, beside the
tool probe) into `SupportedMaterialsContext`. Before it answers every material counts as supported; if the
read fails only `pdf` does. `materialAttached(m, supported)` = supported and `m.attach ?? true`; the lectures'
rules below take `attachedMaterials(...)`, never the raw list.

`materialIndicator` drives the Summary row's chip over the attached set: before a summary, `no material found`,
`no material will be sent` (materials, none attached), `summary with <name>` or `summary with # materials`.
After one, with the tree's `summaryMaterials` record (the disk names attached at the last Summarize): the same set as
the currently attached names is "used"; any difference — a toggle, a new download, a delete — is the
amber "Attachments changed since the summary" (`attachmentsChanged`, which never reports a change while the support read is pending or fell back to `FALLBACK_SUPPORTED`). Without a record (`null`, a summary
made before it existed) each material's mtime against the summary's picks all used (green), none used
(grey), or `N of M` (amber), and nothing attached gets no chip; **mtime is a proxy for "was fed to the
model"** — re-downloading an unchanged file reads as unused.

**Materials-only lectures.** No `video.mp4`, no `audio.mp3` and at least one attached material (`isMaterialsOnly`, mirroring the
backend) summarizes from the materials alone. `lectureProgress.ts` holds the shared predicates: `skippedStage`
marks the missing Video, Audio and Transcript rows "skipped (no video)" with no button, and leaves them out
of "N of M complete", "step N of M" and the runner rail; `stagePrereqMet` lets Summarize start without a
transcript; `canRunRemaining` skips them as `next_step` does. Runs are manual only — `notQueued` and the
sidebar stay video-only. "summarized from materials only" under the Summary row
(`.pipeline-materials-note`) is derived from files alone (`summarizedFromMaterials`: summary, no
transcript, materials-only); there is no marker, and a later video upload takes the usual wipe. So once `video.mp4`, `audio.mp3` and
`transcript.txt` are deleted by hand, a transcript-based summary reads as "materials only" — accepted, since the note has no
marker to tell them apart.

**Removed files.** The tree's `removed` lists a video or audio missing from disk with later evidence
(video: audio or transcript there; audio: transcript there), whoever deleted it — auto-remove
([SETTINGS.md](SETTINGS.md)) or the user by hand.
`markRemoved` flags them present, mirroring the backend's `_mark_removed`, and every `lectureProgress.ts`
rule reads that map, so a stripped lecture is never materials-only and resumes where the backend's
`next_step` does; `notQueued` and the sidebar's drop confirm count a removed video too (`holdsFile`).
Its row shows the grey `removed` `StatusNode`, a greyed name and "Removed", with no action (`stageControl`);
a step whose input was removed (rotate, or run) is disabled with a tooltip saying so. `.pipeline-row--removed` marks the row.

## Assignment view

`/course/:course/assignment/:assignment` (`AssignmentView`, `assignmentRoute`; four segments, so no lecture or
overview URL reaches it) lists the assignment's files with sizes. A name opens through
`openAssignmentFile` (bridge `open.file`, else a new tab on the database route), via the same
`MaterialNameButton` the material chips use. "Open with…" (`OpenWithMenu`) shows on Windows packaged only,
and "Show in folder" calls `open.reveal` — disabled with a tooltip without `canReveal()` (browser dev, older
launcher). A rejected bridge call toasts its message. The header carries `StudyDoneButton` (`kind="assignment"`, `setAssignmentDone`), the same toggle as the lecture page. No viewer, delete or rename.

## Study with AI

`components/StudyWithAiCard` sits in a column on the inline-end side of the pipeline list, top-aligned
with it, once the page body (a container) is 640px wide — 334px of steps + 26px gap + a 280px card, so a
1280px window with the sidebar and tree pane open (664px) splits even with a 17px scrollbar. The card grows
to 340px as the steps reach 380px (where the English Summary row's material chip stops wrapping, at 746px);
the page column widens to the routed pages' 880px and the steps take what the card leaves. Narrower, it stacks below the list and last-error block, before Materials, capped at 560px and
centred. The card lays out tile, title and split button side by side, the subtitle under the title; below
420px of its own width (the side column included) the subtitle drops to a full-width row under them at
`--fs-body` with `text-wrap: pretty`, so no lone word ends it, and below 330px the split button takes its own row too. Its split button's main half reads `summary.md`
(`fetchSummaryContent`), copies it under a fixed study prompt in the UI language, then opens the chosen
chat's fresh-chat page through `openExternalUrl`; nothing is prefilled or sent, the user pastes. A failed
read toasts its failure and a refused clipboard its own error, and neither opens the chat. The clipboard
text (`utils/aiChat.ts`'s `clipboardText`, with `"` in either name turned to `'`):

```
{prompt}

<lecture course="{course}" title="{lecture}">
{summary}
</lecture>
```

The paste hint sits below the card, outside its border, in its own thin `--text`-outlined box that hugs
its text, centred under the card.

`data-state` is `ready` with a summary, else `no-summary`: muted, the main half disabled and the paste hint
hidden, while the provider half still opens its menu. A pick there saves `aiProvider` through
`saveSettings` and pushes the answer into `SettingsContext`, so `/settings` shows the same chat
([SETTINGS.md](SETTINGS.md)).

## Runner status and in-flight state

`RunnerStatusContext` holds `GET /status`, refreshed by `SnapshotProvider` (in `Layout`) on mount and
every notify together with the tree, never polled. `inFlight` covers active steps from any trigger;
`errors` keeps a lecture's last failure after it leaves; `runner.lastError` is an exception that aborted a sweep, distinct from per-step failures. Keys are
`course||lecture||kind` (`shared/utils/inFlightKey.ts`) and **must mirror `_skey` in
`backend/pipeline/runner.py`**. `/running` is the whole surface for the queue, the in-flight entries and
the lectures nothing will pick up; the sidebar row reads only `runner` for its badge.
An assignment run (`kind: "assignment"`, the name in the `lecture` slot, keyed `course||name||assignment`) is
never queued: `/running` lists it as a link row after the lecture rows, never as the focus card, with the step
label from `assignmentStepLabel`; its toast is led by `AssignmentLead`. `getAssignmentRun` / `getAssignmentError`
read it.
On `/running` an in-flight row is one link to its lecture. A waiting row's text acts instead, and only its
trailing icon opens the lecture. A not-queued row shows `failed` or `quota` from `errors` (pending otherwise) and runs its pipeline beside the runner, and a queued one
moves to the front (the head row's text is inert). Either way the reorder arrives over SSE.

`errors` maps each key to `{ step, message, code, params, provider, blocked }`. The "Last error" box and
the toast both render it through `ServiceError` ([I18N.md](I18N.md)), the toast led by `LectureLead`, the lecture and course
`parseInFlightKey` reads off the key, since it shows on any page; `isQuotaError` (`utils/runError.ts`)
tests the four quota codes (two Gemini, two Groq) `backend/pipeline/runner.py` spells, which is also what marks the row's glyph.

Error toasts go through `useReportOnce`, which dedupes `(key, failureId)` across refreshes; `prune` lets a
key fire again if the error recurs. A run that fails within milliseconds (a locked file) can clear and re-set
an identical error between two refreshes, so a caller whose run answered `started` calls `markStarted`: it
rearms the key and hides the old error from every `/status` issued before the answer, since the backend
clears it before serving any later request. A quota toasts only when not `blocked` — the lecture that hit the limit,
not each one run-all then stopped at summarize.

`useRemoteInflightState` turns the open lecture's entry into a render descriptor; progress comes from the
entry, else from `transcript.partial.txt` for a transcribe step. `useTimingStats(step, bytes)` fetches the
backend's regression estimate for the step's _input_ size and drops answers for a key the caller left.
`timingKey` picks the key: a materials-only summarize with no transcript reads the backend's own
`summarize_materials` bucket over the summed attached-material bytes, so materials-only runs never borrow the transcript ETA.

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

The brand, then six route rows — Lectures, Running pipelines, Downloads, Chrome extension, Search, Settings — exactly one
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

`LecturesTreePane` renders beside `/`, the overview, an assignment and `/:course/:lecture` only. It holds the active
`CourseGroup`s, `ArchivedSection` and `New course`, inside `PendingUploadProvider` so an mp4 dropped on a
lecture row can prompt. With no active course, `courseLoadNotice` centres a `.tree-pane-empty` note in the nav: one pointing at Downloads and `New course` once a load succeeds, or "Courses failed to load." (`.tree-pane-empty--failed`, on `--danger-soft` since `--danger` text on the dark pane is unreadable) whenever the latest load failed. An expanded course opens with an Overview row; the course header only toggles.

The home route `/` is an `EmptyCard` asking to pick a lecture. With no active course, `courseLoadNotice`
(`shared/utils/`, shared with Search) swaps it for a hint to add one (`.main-view--no-courses`) once a load
succeeds, or the danger-bordered "Courses failed to load." (`.main-view--failed`) whenever the latest load failed.

A course, lecture or editor route whose target the tree lacks renders `NotFoundPanel`; `routeMiss`
(`shared/utils/notFound.ts`) turns it into the same danger-bordered "Courses failed to load." (`.main-view--failed`)
when the latest load failed, since a stale or empty tree can't prove the target is gone.

`utils/lectureProgress.ts`'s `isLectureComplete` (the last pipeline output exists, mirroring the backend's
`final_output()`, whatever earlier file is gone) reads `Complete` on the lecture page; the tree shows study
progress instead. Lectures, recitations and assignments are three tracks, and `utils/studyProgress.ts`'s `trackProgress`
reads one in the tree's order: the user's manual `done` marks count toward `done/total`, and its current item
is the first not done, strictly — an earlier gap stays current. Each row's mark is a ✓ when done, an arrow
on its track's current item and empty otherwise; a running or queued row shows a spinner in its place.
Marks are display-only. The course header counts lectures, the Recitations header recitations, the Assignments header assignments
(`AssignmentsGroup`, through the same `trackProgress`); assignments never count toward the course header. An
archived course shows no count.

**A lectures-only course** (the tree's resolved `lectures_only`, never the setting — [SETTINGS.md](SETTINGS.md))
has one track: `utils/courseTree.ts`'s `lectureTrack` merges its recitations into the lecture list with no
badge and no Recitations group, in `lectureSort.ts`'s `compareMerged` order — by number, a lecture before
the recitation of the same number, then sub; unnumbered names last, by name. Each `TrackItem` keeps its real
kind, so routes, requests and the header count, `CurrentStudy` and next-name logic all read the same list.
Only new items are forced to `lecture` (add-item, both download forms); a name that is an existing
recitation's keeps `recitation` (`lecturesOnlyKind`), since nothing moves.

- `CourseTreeContext` exposes `courses`, `loaded`, `loadFailed` and `refreshCourses`; `SnapshotProvider` fills it, refreshing
  on notify together with `/status`, and sorts courses by name (`localeCompare`) and their lectures through
  `sortLectures`. Everything reads it directly, no props
  or outlet context.
- `CourseGroup` owns `expanded`, `recExpanded` and `assignExpanded`, so the sub-groups survive collapsing the
  course. It auto-expands when one of its lectures, its overview or an assignment is the open route (deep links).
- `AssignmentsGroup` lists the course's `assignments` after the recitations, styled like them, whatever
  `lectures_only` says and never folded into the lectures; nothing creates one by hand, so a course
  without any shows no group. Rows carry ✓/arrow marks and a done/total count.
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
half); recitations have no sub-sessions ([I18N.md](I18N.md) for the prefix). In a lectures-only course the
newest item in merged order decides — a recitation newest suggests the next whole number — and the prefix
is always the lectures', matching the extension popup. `lectureSort.ts` orders by
`(number, sub-number, name)` parsed with the same any-prefix regex; unparsed names sort first, alphabetically.
