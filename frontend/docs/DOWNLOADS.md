# Downloads page

`/downloads` — connect the BIU account, keep each course's source URL, then discover and download
recordings into the same `DATA_ROOT` courses the pipeline uses. Talks to two services: the auto-downloader
(:3053) for auth, discovery and queueing, and the downloader server (:3052) for job progress — see
`services.md` for their clients and error signals.

## Auth

`AuthPill` probes `/auth/status` on mount. Connect pops a headed browser on the host for MFA and returns
immediately; the pill then waits for the user to click Done, which calls `/auth/complete` to persist the
storage state and re-probes.

A `ReconnectError` from anywhere on the page toasts a hint and bumps `reconnectKey`, which is the `key` on
`<AuthPill>` — remounting forces a fresh probe, since the pill's cached status predates the 401 and would
otherwise still read "connected".

## Discovery

One course is selected at a time; `listRecordings(sourceUrl)` returns a flat `Item[]` in page order. Items
are grouped into sections by `item.section` (the Moodle heading) in first-seen order, blank → "Other".

An item is either downloadable or `expandable` (a playlist). `SectionGroup` — not the row — owns the
expand state, the fetched children and the cache, because the bulk queue needs resolved children and the
"Download all" button needs to know whether every playlist is expanded. Children are cached on first
expand, so collapse/re-expand never refetches. Expandable rows render their children as recursive
`RecordingRow`s.

## Row name and kind: one source of truth

`RowEditsContext` (provided by `SectionGroup`, keyed by `item.ref`) stores **only overrides** —
`{ name?, kind? }`. `resolveRow` derives `{ kind, suggestion, value, name }` from an override plus the live
tree. Two consequences fall out of storing overrides rather than values:

- With no `name` override the displayed name keeps tracking the kind toggle; the first keystroke pins it.
- The green "already downloaded" row and the bulk queue's skip rule read the same resolved values, so they
  can never disagree.

Edits are never cleared, so they survive an SSE tree refresh, a collapse/re-expand, and a bulk run.

`isDownloaded(name, kind, courses, course)` is the single already-downloaded rule (exact name match in the
live tree). It drives both the green row and the queue's skip. A single row's Download on an existing name
opens an overwrite confirm first; the bulk run skips instead.

`suggestItemName` derives the name from the recording title: the first integer becomes `Lecture N` /
`Recitation N`, plus at most one sub-session marker glued to those digits (optionally after `.`/`-`/`_`) as
a decimal — a Latin letter (a=1…z=26), one of `אבגדהוזחטי` (א=1…י=10), or a bare digit when a separator is
present. Ambiguity voids the marker rather than guessing (whitespace, a second letter, a date tail), and a
title with no number at all falls back to the tree's next-number suggestion.

A row's failure to *start* flips the button to "Retry ✗" and toasts via `toastDownloadError` (generic copy,
except an `UnsupportedError` whose message is display-ready). Reconnect, passcode and a cancelled passcode
prompt don't toast — they steer the UI elsewhere. A failure *after* the start is a job failure, below.

## Download progress

`POST /download-item` returns `{ ok, jobs: [id] }` — a 200 only means the download was queued, and the
curl/yt-dlp job runs on in the background (a zoom before/after-break pair yields two ids, everything else
one). The 200 is never the row's outcome — treating it as one reports "Downloaded ✓" mid-download and
swallows every background failure.

The jobs context mirrors the pipeline's `RunnerStatusContext`: `GET /jobs` is the **single source of
truth**, and the stream is a contentless "refetch now" ping. `GET /events` (SSE) fires one event,
`job:change` (`data: {}`), on every job transition — queued, start, end. Each ping refetches `/jobs`; **no
byte count is transported** — the bar is a client-side ETA animation, so following a download costs one open
connection and a refetch per transition rather than a request per second.

`GET /jobs` returns every non-evicted `DownloadJob` (5 min retention after terminal), including ones the
Chrome extension started. Each job carries the discovery-row **`ref`** it belongs to: a zoom
before/after-break pair lands under lecture names `<name>.1`/`<name>.2`, but both jobs carry the parent
row's `ref`. So the row-to-job link is server-side — no client id↔row map, no seeding, no delta merge.

`DownloadJobsProvider` (mounted in `DownloadsView` above the panel, so the snapshot survives a close and
re-discover) owns **one EventSource for the page** and holds the latest `/jobs` snapshot. `open` fires on
connect and every auto-reconnect and also refetches, so the initial sync and any events missed during a
reconnect gap are covered. A failed refetch is a no-op — the stream reconnects and pings again.

**Re-attaching after a reload just works.** `progressOf(ref)` filters the snapshot by `job.ref === ref`, so
a download still running after a reload (or one the extension started) shows on its row with no extra
lookup. A queued job pings too, so the row flips into flight from the snapshot alone once the POST returns.

**A `ref` groups the row; its jobs are the display atoms.** `progressOf(ref)` returns a `JobProgress[]` —
one entry per matching job (id, `job.lecture` title, `status`, `startedAt`, `expectedBytes`, `operation`),
sorted by lecture so a zoom pair's two bars never reorder. The row maps each to a `JobProgressBar`, which
owns its own `useTimingStats(operation, expectedBytes)` call — so each clip regresses independently and one
unknown probe blanks only its own bar (no summing, no null-poisoning across siblings). `tool: curl` →
`download:curl`, `yt-dlp` → `download:ytdlp`, two buckets because their throughput profiles differ. A null
`expectedBytes` shows "Not enough data to estimate"; so does a tool with too few recorded runs. The per-bar
`.1`/`.2` title shows only when a row has more than one bar — a lone bar leaves it off (the row already
names it). The 99% non-zoom case is one job → one untitled bar, unchanged.

Whole-row state comes from `rowStatus(jobs)` (running if any job is non-terminal, else error if any failed,
else done, else null) — the button, confirm-overwrite and passcode flows stay whole-row and keyed on `ref`.

Each bar is literally `MainView`'s — same component, same `Estimating…` / `Not enough data to estimate` /
`Nm Ns remaining` / `Taking longer than expected` states; the bars render as a full-width block stacked
below the row line (`.recording-entry` wraps the two). While any job runs, the button reads "Downloading…"
and is disabled; on all-done it reads
"Downloaded ✓" (the SSE tree refresh lands at the same moment and tints the row green), on error "Retry ✗".

The provider — not the row — toasts a job failure via `toastJobError`, so one place covers single and bulk
rows alike. It toasts each error id once (a failed job lingers the full 5-minute retention), guarded by a
`primed` flag: the first snapshot's errors are seeded into the toasted set and suppressed, since a failure
already terminal before this session saw it is history, not a live outcome.

## Bulk download

"Download all" flattens the section into downloadable leaves — a playlist contributes its children, never
its own ref, which the backend rejects. It is disabled until every expandable is expanded, and never
auto-expands.

The **triggering** runs sequentially by design: the auto-downloader drives one shared browser session, so
parallel requests would contend. The downloads themselves run on, so by the end of the queue several rows
are downloading at once, each with its own bar. The run is in continue mode (already-present items are
skipped and tallied) and reads both the course tree and the edits through refs, so a mid-run SSE refresh or
a name typed while it runs is honoured rather than the snapshot it started with.

Per-item outcomes: `ReconnectError` aborts the whole run and triggers the reconnect flow; a `PasscodeError`
pauses at that item and opens the prompt (submit saves the passcode and resumes by retrying the same item;
cancel abandons the rest of the queue); anything else marks it failed and continues.

The tally holds the **refs** it started, not a count, so the summary is folded with those rows' live job
status: the header shows `Downloading n/N…` while triggering, `Downloading n more…` while the last jobs
finish, and only then the `N downloaded, N failed, N already there` summary. "Download all" stays disabled
until they are all terminal. The bulk run never toasts per item itself — a job failure toasts once from the
provider.

## Zoom passcode

`PasscodePrompt` is a masked-input modal mirroring `ConfirmModal`'s portal + Escape/overlay-cancel shape
(`ConfirmModal` can't host an input). It owns its input and scope state, and the parent unmounts it between
openings so a wrong-passcode re-prompt mounts fresh and empty. Scope defaults to course-wide; "just this
lecture" narrows it to the one recording.

In a single row, the passcode prompt and the overwrite confirm can never co-render — the confirm is already
dismissed by the time `download()` can hit the 409. The row keeps its spinner on across save → retry so it
doesn't flash off while the passcode is stored.
