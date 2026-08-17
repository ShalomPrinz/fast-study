# Downloads page

`/downloads` — connect the BIU account, keep each course's source URL, then discover and download
recordings into the same `DATA_ROOT` courses the pipeline uses. Talks to two services: the auto-downloader
(:3053) for auth and discovery, and the downloader server (:3052) for queueing downloads, their job progress
and each section's bulk run — see `SERVICES.md` for their clients and error signals.

## Auth

`AuthPill` probes `/auth/status` on mount. Connect pops a headed browser on the host for MFA and returns
immediately; the pill then waits for the user to click Done, which calls `/auth/complete` to persist the
storage state and re-probes.

A `ReconnectError` from anywhere on the page toasts a hint and bumps `reconnectKey`, which is the `key` on
`<AuthPill>` — remounting forces a fresh probe, since the pill's cached status predates the 401 and would
otherwise still read "connected".

## The page session

Everything the page discovers or accumulates — `selected`, `items`, `loading`/`error`, the row edits, the
playlist expansions and `reconnectKey` — lives in `DownloadsSessionProvider`
(`contexts/DownloadsSessionContext.tsx`), mounted in `Layout` above the outlet. `/downloads` is a route, so
its view unmounts on any navigation; holding the session above the router is what lets the user open a
lecture and come back to the same course and the same typed names. `discover`
and `close` live there too, so a discovery still in flight when the user navigates away lands anyway.

Two contexts, as with the row edits: state, and an **identity-stable** actions bag. Stability is
load-bearing — the memoized rows bail out on the setters' identity. The provider renders `{children}` and
nothing else, so a keystroke in a row re-renders its consumers and leaves the sidebar and the outlet alone.

`DownloadJobsProvider` is mounted in `Layout` too, just outside the session provider, and
`SectionRunsProvider` just inside it (it raises the session's own reconnect hint). Both stores are
module-level but each provider owns its connection and clears its store on
unmount, so mounting them app-wide is what keeps the SSE subscriptions, the snapshots and the error-toast
dedupe alive across navigation. One consequence: a job that fails while the user is on a lecture page toasts
there and then, instead of being reseeded away as history by `primed` on a later remount.

## Discovery

One course is selected at a time; `listRecordings(sourceUrl)` returns a flat `Item[]` in page order.

Each item carries `media`, one of three values: `'material'` for a Moodle PDF resource (appended as the
lecture's next `material.N.pdf`), `'unknown'` for a Google Drive row — a Drive `url` module carries no
filename, so auto genuinely cannot tell a video from a PDF from a `.zip` without a download-time probe —
and `'video'` for everything else (lands as `video.mp4`). The destination file is derived server-side from
the opaque `ref` — the frontend only branches its own affordances on `media`, it never sends it.

An `unknown` item may also carry `resolvedMedia` (`'video' | 'material' | 'unsupported'`), what auto's
session probe cache found the file to be; it is absent until the file has been probed once, and
`'unsupported'` means a real file the downloader can't fetch (a `.zip`). **A row never changes segment
when it resolves** — the answer shows up as a column instead (below).

A `ModeToggle` under the panel header splits the three — **Videos** (default), **Materials**, **Unknown** —
and `groupSections(items, media)` filters by `media` _before_ grouping by `item.section` (the
Moodle heading) in first-seen order, blank → "Other". So each side shows only its own sections, a section
with nothing on the active side doesn't render, and an empty side shows its own "No recordings found." /
"No materials found." / "No files of unknown type found." while every segment stays clickable.
`groupSections` is a pure helper (`utils/sections.ts`)
precisely so the filter+group rule is testable without a DOM. Everything below a section — including
"Download all" — therefore operates on one media only: a bulk run covers just the active side.

An item is either downloadable or `expandable` (a playlist). The expand state, the fetched children and
the cache live in the session provider — not in the row — because the bulk queue needs resolved children and
the "Download all" button needs to know whether every playlist is expanded; holding them above the media
toggle also keeps them alive across a segment switch. `SectionGroup` drives them: it reads the map and calls
`patchExpansion`, and owns `toggleExpand`, the only caller. Children are cached on
first expand, so collapse/re-expand never refetches. Expandable rows render their children as recursive
`RecordingRow`s.

## Unknown rows and the resolved-type column

An `unknown` row renders one extra narrow column (`.recording-media`): `?` while the type is unknown, then
`Video` / `Material` / `Unsupported`. Video and material rows render nothing there — it would only restate
their segment.

`RecordingRow` reads `item.resolvedMedia` and nothing else. A download reports the verdict upward through
`ResolvedMediaContext` — a dispatch-only context provided by `DownloadsView` from the session's
`resolveMedia`, which stamps it onto the matching item in `items`. `POST /download-item` answers with a `media`, and a 422 `UnsupportedError` is
just as much a verdict, so both update the column on the interaction that resolved it — no re-list. The
provider sits above the media segments deliberately: switching segment unmounts every row and every
`SectionGroup`, so a verdict held in either would be lost on the way back. It still dies with a
re-discover; auto's cache is what makes it survive a reload. A row resolved to `material` picks up the whole material
affordance (attach-to dropdown, material count, no overwrite confirm). An `unsupported` row greys out and
its Download button is disabled; the 422's message names the actual extension and is toasted by
`toastDownloadError`, which already shows an `UnsupportedError` verbatim.

## Row name and kind: one source of truth

`contexts/RowEditsContext.ts` (the map owned by the session provider, exposed by `DownloadsView` above the
media toggle, keyed by `item.ref`) stores **only overrides** — `{ name?, kind? }`. `resolveRow` derives `{ kind, suggestion, value, name }`
from an override plus the live tree. Two consequences fall out of storing overrides rather than values:

- With no `name` override the displayed name keeps tracking the kind toggle; the first keystroke pins it.
- The green "already downloaded" row and the bulk queue's skip rule read the same resolved values, so they
  can never disagree.

Edits are never cleared within a course, so they survive an SSE tree refresh, a collapse/re-expand, a bulk
run, a segment switch — including the one a probe forces when it moves an `unknown` row to Videos — and a
trip to a lecture and back. Discovering another course, or closing the panel, resets the map (along with the
expansions and the runs) so refs from two courses can never collide.

The edits live behind **two** contexts: `RowEditsStateContext` (the map) and `RowEditsDispatchContext`
(`{ setName, setKind }`, identity-stable for the page's lifetime). Only the components that slice the
map subscribe to the state context — `SectionGroup` for its top-level rows, and `ChildRows` for an expanded
playlist's children. `RecordingRow` is `memo`ized and takes its own `edit` slice as a prop, reading only the
dispatch context via `useRowEdit(item, edit, course)`, so a keystroke re-renders just the edited row. The
setters update with `{ ...prev, [ref]: { ...prev[ref], name } }` — leaving every other slice's identity
untouched is what lets the siblings bail out. (An SSE tree refresh still re-renders every row: leaf rows
consume `CourseTreeContext` for the suggestion and the green highlight.)

The bulk queue reads the map **once**, at submit: the whole section is resolved into targets and handed to
the server, so a name typed after that is not picked up by the run already in flight. It still feeds
`ResolvedMediaContext`, now off the run's own recorded verdicts rather than per-item responses, so a bulk
run resolves the `unknown` rows it touches — reported once per ref, since every `run:change` ping re-reads
the same targets.

`hasResource(item, name, kind, courses, course)` is the single already-downloaded rule, so the green row
and the bulk queue's skip can never disagree. It finds the node named `name` in the live tree and checks
what the media implies — `video` → `video.mp4` exists, `material` → `materialsOf(...)` is non-empty. A
lecture that exists but holds neither is not "already there" for either row. `resolvedMedia` wins over
`media` when present; an unprobed `unknown` row (and an `unsupported` one) has no reliable on-disk target,
so it is always false rather than ever showing a wrong "already downloaded".

A video row's Download on an existing target opens an overwrite confirm first; the bulk run skips instead.
For a video row whose base name isn't itself on disk, `splitSiblings` (same lookup) checks for
`${name}.1`/`.2` — a zoom row splits lazily into those during download — and Download opens a "might
overwrite" confirm naming the siblings; exact match takes precedence.

**A material row never confirms.** A material download appends as the next `material.N.pdf` and a PDF
always lands on the one lecture picked, so neither hazard applies; instead the row shows a non-blocking
"N materials" note for the selected lecture, live off the same tree lookup.

## Material rows

A material row picks which lecture the PDF attaches to, and takes its suggestion from `suggestItemName`
like a video row — the Moodle activity title ("שקפי הרצאה 5", "תרגול 3 - פתרונות") names the lecture the
PDF belongs to, so the number in it wins. A numberless title falls through to the next-new name.

The destination field is a native `<input list>` + `<datalist>` of `existingNames(kind, …)`: dropdown of
what exists plus free text for a lecture that doesn't exist yet, in one element with no focus/keyboard
handling to reinvent. The options follow the kind toggle, and the input's `aria-label` reads "Attach material to" rather than
"Lecture name" — the only in-row material affordance, since the media toggle already carries the signal.
The row shell is otherwise shared with video rows; it just drops both confirms and shows the target's
material count instead.

`suggestItemName` derives the name from the recording title: the first integer becomes `Lecture N` /
`Recitation N`, plus at most one sub-session marker glued to those digits (optionally after `.`/`-`/`_`) as
a decimal — a Latin letter (a=1…z=26), one of `אבגדהוזחטי` (א=1…י=10), or a bare digit when a separator is
present. Ambiguity voids the marker rather than guessing (whitespace, a second letter, a date tail), and a
title with no number at all falls back to the tree's next-number suggestion.

A row's failure to _start_ flips the button to "Retry ✗" and toasts via `toastDownloadError` (generic copy,
except an `UnsupportedError` whose message is display-ready). Reconnect, passcode and a cancelled passcode
prompt don't toast — they steer the UI elsewhere. A failure _after_ the start is a job failure, below.

## Download progress

`POST /download-item` (on the downloader server) returns `{ media, jobIds }` — a 200 means queued by
construction (every failure to queue is an error status), `media` is what the file turned out to be, which
resolves an `unknown` row's column, and the curl/yt-dlp job runs on in the background. The row does not
route by `jobIds`: every spawned job is stamped with the row's `ref`, so the row re-finds its jobs in the
snapshot below. The 200 is never the row's outcome — treating it as one reports "Downloaded ✓"
mid-download and swallows every background failure.

The jobs context mirrors the pipeline's `RunnerStatusContext`: `GET /jobs` is the **single source of
truth**, and the stream is a contentless "refetch now" ping. `GET /events` (SSE) fires one event,
`job:change` (`data: {}`), on every job transition — queued, start, end. Each ping refetches `/jobs`; **no
byte count is transported** — the bar is a client-side ETA animation, so following a download costs one open
connection and a refetch per transition rather than a request per second.

`GET /jobs` returns every non-evicted `DownloadJob` (a `done` job is dropped after short bridge period; an `error` has no timeout and is evicted only when a retry supersedes it), including ones the
Chrome extension started. Each job carries the discovery-row **`ref`** it belongs to: a zoom
before/after-break pair lands under lecture names `<name>.1`/`<name>.2`, but both jobs carry the parent
row's `ref`. So the row-to-job link is server-side — no client id↔row map, no seeding, no delta merge.

**One job per target — the server guarantees it.** When the server silently recovers a stale token — or a
manual retry runs — `createJob` calls `supersedeTerminal`, evicting any prior _terminal_ job (`done`/`error`)
for the same `(course, lecture, kind, ref)` before minting the fresh one. So a `/jobs` snapshot never holds
two jobs for one target, and no superseded `error` survives to flash a stale row or toast a recovery that
actually succeeded. The client trusts the snapshot as-is — no client-side dedupe. (A zoom pair's `.1`/`.2`
halves are distinct targets under one `ref`, so both legitimately coexist.)

`DownloadJobsProvider` (mounted in `Layout`, so the connection and the snapshot outlive the route) owns
**one EventSource for the app** — always open, which is the price of following downloads from anywhere — and feeds each `/jobs` snapshot into the module-level
store in `DownloadJobsContext.tsx`. `open` fires on connect and every auto-reconnect and also refetches, so
the initial sync and any events missed during a reconnect gap are covered. A failed refetch is a no-op —
the stream reconnects and pings again.

The store keeps no context value: each snapshot is grouped **once** into a `Map<ref, JobProgress[]>`, and
rows read it through `useSyncExternalStore`. `useRowJobs(ref)` subscribes a row to its own ref, so a ping
re-renders only the rows that _have_ jobs — the memoized rows with none read one shared frozen `EMPTY_JOBS`
and bail out. That's the whole win, and on a section where one row is downloading it's the difference
between one re-render and all of them; grouping allocates a fresh bucket array per ref per snapshot, so a
row with jobs re-renders on every ping regardless. `useJobsByRef()` hands `SectionGroup` the whole map,
which is the right scope there: the bulk summary reads arbitrary refs the run queued. (A context is still mounted, purely to fail loudly when a hook is
used outside the provider.)

**Re-attaching after a reload just works.** The grouping keys on `job.ref`, so a download still running
after a reload shows on its row with no extra lookup. A queued job pings too, so the row flips into flight
from the snapshot alone once the POST returns. A job with a **null `ref`** is one the Chrome extension
started; it belongs to no discovery row and is dropped while grouping.

**A `ref` groups the row; its jobs are the display atoms.** Each bucket is a `JobProgress[]` — one entry per
matching job (id, `job.lecture` title, plus `ref`/`course`/`kind` for retry, `status`, `startedAt`,
`expectedBytes`, `operation`), sorted by lecture so a zoom pair's two bars never reorder.
`RecordingJobList` maps each to a `JobProgressBar`, which owns its own `useTimingStats(operation, expectedBytes)` call —
so each clip regresses independently and one unknown probe blanks only its own bar (no summing, no
null-poisoning across siblings). `tool: curl` → `download:curl`, `yt-dlp` → `download:ytdlp`, two buckets
because their throughput profiles differ. A null `expectedBytes` shows "Not enough data to estimate"; so
does a tool with too few recorded runs. The per-bar `.1`/`.2` title shows only when a row has more than one
bar — a lone bar leaves it off (the row already names it). The 99% non-zoom case is one job → one untitled
bar, unchanged.

**Per-clip retry.** On a multi-job (zoom-pair) row, a terminal job renders a per-clip **Retry ✗** (error)
or **Re-download ↻** (done) button instead of a bar, so one failed half replays without touching the other.
It re-issues `POST /download-item` with `{ ref, course, name: job.lecture, kind, only: true }` (`only`
re-triggers just that named clip) and reuses the row's reconnect/passcode gates via the shared `runIntent`.
A done clip's **Re-download ↻** overwrites, so it opens the overwrite confirm named for that clip (`job.title`)
and only replays on Yes; an errored clip's **Retry ✗** downloaded nothing to overwrite, so it retries directly.
A lone job needs no per-clip button — its retry lives on the main row button, which replays the whole row.

Whole-row state comes from `rowStatus(jobs)` (running if any job is non-terminal, else error if any failed,
else done, else null). On a split row (`jobs.length > 1`) the per-clip buttons own re-download/retry, so the
main control becomes a non-clickable status label (`.recording-download-btn--label`) — "Downloading…" /
"Downloaded ✓" / "Failed ✗" — never triggering a whole-row overwrite. Non-split rows keep the clickable
button; confirm-overwrite and passcode flows stay whole-row and keyed on `ref`.

`RecordingRow` is the integrator: it derives the display (`jobs`/`status`/`split`/`alreadyDownloaded`) and
owns the overwrite confirm. `useRecordingDownload` is the download effect only — the action plus its own
pending/retry/queue-failure/passcode state. `RecordingJobList` is the presentational per-job block.

Each bar is literally `MainView`'s — same component, same `Estimating…` / `Not enough data to estimate` /
`Nm Ns remaining` / `Taking longer than expected` states; the bars render as a full-width block stacked
below the row line (`.recording-entry` wraps the two). While any job runs, the button reads "Downloading…"
and is disabled; on all-done it reads
"Downloaded ✓" (the SSE tree refresh lands at the same moment and tints the row green), on error "Retry ✗".

The provider — not the row — toasts a job failure via `toastJobError`, so one place covers single and bulk
rows alike. It toasts each error id once (a failed job lingers until a retry supersedes it), guarded by a
`primed` flag: the first snapshot's errors are seeded into the toasted set and suppressed, since a failure
already terminal before this session saw it is history, not a live outcome.

## Bulk download

**The page starts a run and then only reflects it.** "Download all" is one `POST /download-section`; the
queue, its progress, each row's disposition and the passcode pause are the downloader server's
(`downloader/server/docs/RUNS.md`), and the page reads them back. So a run survives a segment switch, a
closed recordings panel, a reload and a closed tab — the client-side queue it replaced died with the tab,
losing the progress and a prompt the user was one keystroke from answering. This mirrors
`RunnerStatusContext` over the pipeline runner, and `DownloadJobsContext` structurally.

`SectionRunsProvider` (`contexts/SectionRunsContext.tsx`, mounted in `Layout` inside the session provider)
is that reflection: one `EventSource` for the contentless `run:change` ping, a `GET /runs` refetch per ping,
and a module-level store keyed by `sectionId` that `useSectionRun(id)` subscribes to per section. Refetches
carry a monotonic sequence and only the newest one publishes: the driver pings several times per target, so
overlapping `GET /runs` can answer out of order, and an older reply landing after the terminal `done`
snapshot would strand the section on "Downloading…" — `done` is the last frame a run emits. The key is
the section's own identity `${course}:${media}:${title}` (the same string that keys the `SectionGroup`
element) and the server holds one run per key. Both qualifiers matter: one Moodle heading usually holds both
a video and its slides, and a run outlives the course it started in.

A run is `{ id, sectionId, course, targets, at, total, status, paused }`. `status` is
`running | paused | done | reconnect | cancelled`, `at` is the 1-based position the queue is on, and `paused`
is `{ index, reason, name }` or null. `RunTarget` — `{ ref, name, kind, media, disposition }` — is a
**cross-wire contract**: TypeScript in `services/downloadServer.ts`, plain JS in the server's `runs.js`.
Change one, change the other. `disposition` is what the run itself decided: `pending` (the queue has not
reached it), `skipped`, `unsupported`, `queue-failed` — or `queued`, the only one whose outcome is still
open. `media` is the POST's answer for a queued row and `resolvedMedia ?? media` otherwise, because it is
what says where the download lands on disk.

**Nothing about the outcome is stored.** `utils/runStatus.ts` derives it on every render, per target and in
this order: `pending` is not-yet-started and stops there; a recorded non-`queued` disposition wins; else one
of the target's jobs is `running` → `in-flight`; else the row landed in the course tree → `downloaded`; else
one of its jobs is an `error` → `failed`; else `in-flight`. `pending` needs its own answer precisely because
the run holds its whole queue from the start: absence of a job means "not triggered yet" for those rows,
where for a `queued` row it means "the snapshot has not caught up". `summarize` counts those into
`N downloaded, N failed, N unsupported, N already there` (each part only when non-zero; `pending` and
`in-flight` are counted nowhere). Both are pure and unit-tested; `SectionGroup` is their only caller, and its
three inputs — the run, the tree and the jobs — are all live reflections a remount simply re-reads.

A running job outranks the tree because a zoom share downloads as two clips: once `name.1` lands the tree
would already say `downloaded` while `name.2` is still going, and the section would free its "Download all"
button mid-run. "The target's jobs" is `ref` **and** name-scoped (`name`, `name.1`, `name.2`): a job is keyed
by lecture name while the target is keyed by ref, so a row renamed between runs leaves the old name's jobs
under the same ref, and they are not this target's outcome.

That works because each half of the derivation is durable where the jobs are not. The tree — read through
`targetLanded`, which asks `hasResource` about `name`, `name.1` and `name.2` alike, so a zoom share that
lands as split clips still counts — owns "downloaded"; the download server evicts a `done` job 60s later
precisely because it is only bridging until the tree SSE arrives. Every candidate name goes through the one
`hasResource` rule so that a bare `name.1` folder left by an earlier run cannot read as landed on a row the
queue's own skip would still queue. An `error` job is never time-evicted and `createJob` supersedes any
earlier terminal job for the same target, so it is positive evidence that the _latest_ attempt failed — no
baseline of pre-existing jobs to subtract. And absence of evidence reads as "still going", which is exactly
right in the window after the POST where the browser's `/jobs` snapshot has not caught up.

The line is therefore live: retrying a failed row from its own button improves it, and deleting a lecture
folder with the page open changes it too.

**Busy is positive evidence, never the fallback.** The derivation's last branch — absence of evidence reads
as "still going" — is honest for a summary but has no expiry, so it must not decide whether the section is
busy: a `queued` row that permanently loses both its sources would hold "Download all" disabled forever, and
that button is the only thing that could replace the run. `runningCount` is therefore its own rule — a target
with a `running` job — which is exactly what a single row's own button uses (`rowStatus(jobs) === 'running'`,
`RecordingRow.tsx`), and why the single-download path never had this failure mode. A running job cannot
outlive the work, so the section always frees itself. It still covers the tail after the queue finishes,
because the jobs are what outlive the queue.

**Unverified rows.** `unverifiedCount` names the set the run can no longer account for (`queued`, no jobs at
all, not in the tree), meaningful only once the run has stopped. They no longer hold the section busy, but
`summarize` counts them nowhere, so a 4-row section would silently read "3 downloaded". Instead the section
renders a warning line below the header saying how many and why — the causes are all outside the run and
unguessable from here: the lecture was deleted or renamed after landing, the name the run holds desynced
from the one on disk, or the tree is briefly unreachable (`CourseTreeContext` publishes an empty tree on
failure, which flips every landed row at once). There is no action attached because none of them is fixable
from this page.

Two limits follow from deriving with no memory:

- For one SSE round-trip after a retry POST, the just-superseded `error` job is still in the browser's
  snapshot, so the target flickers through `failed` before the fresh `running` job arrives.
- A half-failed zoom pair reads as `downloaded`: with no job running, the `.1` clip on disk satisfies
  `targetLanded` before the `error` job for `.2` is reached. Per-half accounting needs the POST to return
  job ids, which it does not.

"Download all" flattens the section into downloadable leaves — a playlist contributes its children, never
its own ref, which the backend rejects. It is disabled until every expandable is expanded, and never
auto-expands. Each leaf is resolved into a `RunTarget` **at submit**: the name and kind the row shows
(`resolveRow`), plus the two verdicts this page owns because they read the live course tree — `skipped` for
a row already on disk (`hasResource`, the same rule that tints the row green, so the two can never disagree)
and `unsupported` for a row a probe already condemned. Everything else goes over as `pending`. Starting a run
replaces whatever run that section had.

**Two costs of the run being server-owned**, both accepted: a name typed *while the queue runs* is no longer
picked up when that row's turn arrives — the server got every name up front — and a row downloaded by
something outside this run mid-queue is no longer skipped, since the skip set was computed at submit; it is
re-triggered and overwrites itself.

The **triggering** runs sequentially by design: the auto-downloader drives one shared browser session, so
parallel requests would contend. The downloads themselves run on, so by the end of the queue several rows
are downloading at once, each with its own bar.

Per-item outcomes are the server's, and it maps them exactly as the client-side queue used to: a 401 stops
the run at `reconnect`; a 409 parks it at that index with `paused`; a 422 records `unsupported` (see below);
anything else records `queue-failed` and continues.

`unsupported` is counted apart from `failed` because it is not a run problem and, unlike a failure, it is
permanent: a row already known unsupported is skipped before the request, so four `.zip`s cost one probe
round-trip each per server lifetime rather than one per bulk run. Since the bulk run never toasts per item,
recording the verdict is also the only thing that carries the 422's reason out of the run — as the greyed
row and its column.

The header renders three states in order: `Downloading {at}/{total}…` while the run is `running` or `paused`,
else `Downloading n more…` for the targets with a running job, else the derived summary (shown only once the
section has a run at all). "Download all" stays disabled through the first two, and the unverified warning
renders below the header independently of which of the three is showing. The bulk run never toasts per
item itself — a job failure toasts once from the jobs provider.

A run that ends at `reconnect` raises the page's "BIU session expired" hint, and the provider — not the
section — owns that: a status is re-read on every ping, so it fires **once per run id**, held in a set beside
a `primed` flag that seeds the first snapshot. A run already aborted before the page loaded is history, and
the auth pill probes on mount anyway.

## Zoom passcode

`PasscodePrompt` is a masked-input modal mirroring `ConfirmModal`'s portal + Escape/overlay-cancel shape
(`ConfirmModal` can't host an input). It owns its input and scope state, and the parent unmounts it between
openings so a wrong-passcode re-prompt mounts fresh and empty. Scope defaults to course-wide; "just this
lecture" narrows it to the one recording.

A bulk run's pause is a **rendered status, not held state**: the prompt renders whenever the reflected run
reads `paused`, from `run.paused.{reason,name}`. So a gate hit while the user is on another page — or after
a reload — still asks when the section renders again, and the server holds the queue there indefinitely
rather than hanging on a prompt that never mounted. Submitting saves the passcode through auto (the passcode
store stays there) and then `POST /runs/:id/resume`, which retries that same row; a failed save resumes with
`{skip:true}`, giving up on the gated row and continuing from the next. Cancel is `POST /runs/:id/cancel` and
abandons the rest of the queue, not just the gated row. The only run state left in `SectionGroup` is the
save's own in-flight flag, which drives the prompt's busy state; a double submit is the server's to reject
(409 on a run that is no longer parked), not a race the component guards.

In a single row, the passcode prompt and the overwrite confirm can never co-render — the confirm is already
dismissed by the time `download()` can hit the 409. The modal's own `savingPasscode` busy state drives its
spinner; on submit it saves the passcode and resumes whichever intent hit the gate (row download or a
per-clip retry) via `passcodeResume`, closing the modal and starting the resume in one render so no spinner
flashes off.
