# Download jobs (`src/jobs.js`, `src/events.js`)

The job registry exposes each download's lifecycle to consumers outside this process, and
`events.js` pushes its transitions over SSE.

**Why a registry.** `POST /download` answers before the download starts, so its 200 means
"accepted", never "downloaded". Without a job id a caller can't tell a finished download from a
failed one, and a background failure reaches nobody.

**Why the registry survives beside the stream.** The stream is contentless: a `job:change` ping
carries no state, so a client learns what changed only by refetching `/jobs`. The registry is the
state, the stream only notification — and `GET /jobs` is also the resync for a client that
subscribed late or reloaded mid-download.

**The id is minted in the route, not the runner.** `runDownloadJob` awaits `probeSize` (a network
round-trip) before it could register anything, so a client resyncing with the id it just received
would find nothing. `createJob` runs synchronously in the route, before any await.

## Lifecycle

`queued` → `running` (child spawned) → `done` | `error`.

`done` means the file reached the **database**, not that the child exited 0 — in between the bytes
sit in a private temp dir nobody else can see, and a failed upload is an `error` like any other.
First terminal call wins, so a spawn failure (which fires both `error` and `close`) keeps the
informative reason. `message` carries the child's stderr tail, the upload's error, or the thrown
message, and `code`/`params` carry the same failure in machine form (below).

## Silent auth recovery

`/download-item` resolves a row through auto/ before creating anything, so each job knows whether
its cap was **replayed from auto's session cache** (a `.mp4` URL + headers whose token is
short-lived) or freshly captured. That `fromCache` bool lives on the job and is deliberately kept
**out of `/jobs`** — provenance, not client state, like the url and headers. The route also hands
the runner a `reresolve` closure for that one target; an extension-started job has no `ref`, so it
gets `null`.

On a non-zero exit the runner classifies the stderr tail with `isAuthError` (HTTP 401/403 or
denied/expired-token phrasing — the curl `--fail` / yt-dlp signatures):

- **auth error AND `fromCache` AND a closure** → the replayed token went stale. `reresolve()` asks
  auto/ for this one target fresh (`only:true, forceCapture:true`, `services/autodl.js`) and answers
  `{downloader, input}` — the runner re-runs **the same `jobId`**, so the job never leaves `/jobs` and
  its id stays the caller's attempt identity — or `{failure}`, a ready-to-display terminal failure.
  That failure is built in `routes/downloadItem.js`, because what auto's statuses mean is the
  resolver edge's knowledge, not the source-agnostic runner's: 401 → `recapture_reconnect_required`,
  409 → `recapture_passcode_required`, 422 → `recapture_unsupported {detail}`, anything else (a 2xx
  with no usable target included) → `recapture_failed {detail}`.
- **otherwise** → finalized as-is; a fresh-capture auth failure reads "authentication failed".

**No-loop invariant:** the re-run's input is freshly captured, so it runs with `fromCache:false` and
no closure — a second auth failure lands in "otherwise". Exactly one silent recovery per job.

## Events

One contentless frame per transition — queued, start and end — `event: job:change` / `data: {}`;
the client refetches `/jobs`. The queued ping lets the frontend flip a row to in-flight the instant
the job registers, before the child spawns. The same stream carries `run:change` for the section-run
registry ([RUNS.md](RUNS.md)): one stream, two events, each with its own resync endpoint. Bytes are
still measured for the terminal, but never reach the wire.

## Retention

Terminal jobs are kept asymmetrically:

- **`done`** is redundant with durable state — the database course tree (its own SSE) is what flips
  the frontend row green. So a `done` job lingers only `DONE_BRIDGE_MS` to bridge the gap to that tree
  ping. Eviction is deferred, never synchronous: a client resyncing on the `done` ping must still
  find it.
- **`error`** is the ONLY carrier of "this failed" — a failed download leaves no file, so the tree
  can't tell it from never-attempted. It stays with no timeout until a retry supersedes it.

`createJob` evicts **any terminal predecessor** for the same target (course + lecture + kind + ref),
so `/jobs` holds at most one job per target and the frontend does no client-side dedupe. A pending
`DONE_BRIDGE_MS` delete for an already-superseded job then no-ops.

## The `/jobs` shape

`{ id, status, course, lecture, kind, tool, ref, operation, expectedBytes, startedAt, message, code,
params }`. `operation` (`'download:curl'|'download:ytdlp'|null`) derives from `tool` via
`services/timing.js`. `ref` (or `null`) is the discovery row that spawned the job; jobs sharing a
`ref` group under one row, which is what keeps a zoom `<name>.1`/`<name>.2` pair together.

## Failure codes

`message` is English and developer-facing; `code`/`params` are what a client renders from (repo-root
[`docs/ERROR-CODES.md`](../../../docs/ERROR-CODES.md)). All three are `null` on a job that succeeded.

| code                          | params                       | when                                            |
| ----------------------------- | ---------------------------- | ----------------------------------------------- |
| `download_tool_spawn_failed`  | `tool`, `detail`             | the child never started                          |
| `download_tool_failed`        | `tool`, `exit_code`, `detail`| non-zero exit; `detail` is the stderr tail       |
| `download_auth_failed`        | `tool`, `exit_code`, `detail`| the same exit, classified by `isAuthError`       |
| `download_failed`             | `tool`, `detail`             | the probe or command build threw                 |
| `database_store_failed`       | `detail`                     | the bytes never reached the database             |
| `recapture_*`                 | see above                    | the one silent re-resolve failed                 |

## Timing samples

On a clean exit the runner posts `{operation, file_size_bytes, duration_seconds}` to the backend's
`POST /timing` (`services/timing.js`), the samples the frontend's ETA regression is built from.

- `operation` is per tool (`fetch` records none): a curl-replayed in-site `.mp4` and a yt-dlp fetch have very different
  throughput curves, and one merged regression makes both estimates worse.
- `duration_seconds` is wall-clock spawn → exit; the upload is a separate concern.
- `file_size_bytes` is the bytes measured on disk, falling back to the probed size. The backend
  rejects a non-positive size, so a job with neither sends nothing.
- A non-zero exit sends nothing — a truncated download is not a valid sample. Fire-and-forget and
  fully swallowed; it must never fail a download.
