# Download jobs (`src/jobs.js`, `src/events.js`)

`progress.js` renders download progress to the terminal; the job registry exposes the
same lifecycle to consumers outside this process, and `events.js` pushes its transitions
to them over SSE.

**Why a registry at all.** `POST /download` answers before the download starts, so its
200 means "accepted", never "downloaded". Without a job id the caller can't tell a
finished download from a failed one, and a background failure reaches nobody.

**Why the registry survives alongside the stream.** The stream is contentless: a
`job:change` ping carries no state, so a client can only learn what changed by refetching
`/jobs`. The registry is the state; the stream is only notification. `GET /jobs` is also
the resync for a client that subscribes late or reloads mid-download and so missed a ping.

**The id is minted in the route, not the runner.** `runDownloadJob` awaits `probeSize`
(a network round-trip) before it could register anything, so a client resyncing with the
id it just received would find nothing. `createJob` runs synchronously in the route
handler, before any await, which makes that race impossible by construction.

## Lifecycle

`queued` → `running` (child spawned) → `done` | `error`.

`done` means the video reached the **database service**, not that the child exited 0 —
between those two the bytes sit in a private temp dir nobody else can see. A failed
`uploadVideo` is an `error` like any other. First terminal call wins, so a spawn
failure (which fires both `error` and `close`) keeps the informative reason.

`error` carries `message`: the child's stderr tail (`makeStderrTail`, last 15 lines),
the upload's error, or the thrown message — the same text the terminal logs.

## Events

One contentless event, `job:change`, fires on every transition — queued, start, and end:

```
event: job:change
data: {}
```

The frame carries no state; it only says "something changed, refetch". On it the client
re-`GET`s `/jobs`, which is the single source of truth. The queued ping matters: it lets
the frontend flip a row to in-flight the instant the job registers, before the child spawns.

Bytes are still measured on the interval — `progress.js` needs them for the console and
`jobs.js` reads the same `entry` — but they never reach the wire.

## Retention

Finished jobs stay in memory `RETENTION_MS` (5 min) before eviction, so a client that
reconnects shortly after a download ended still resyncs a terminal state instead of a
gap it must guess at.

## Timing samples

On a clean child exit the runner posts `{operation, file_size_bytes, duration_seconds}`
to the backend's `POST /timing` (`services/timing.js`) — the sample the frontend's ETA
regression is built from. This is the downloader's only edge to the backend (8000).

- `operation` is per tool: `download:curl` or `download:ytdlp`. A curl-replayed in-site
  `.mp4` and a yt-dlp YouTube fetch have very different throughput curves; merging them
  into one regression makes both estimates worse.
- `duration_seconds` is wall-clock spawn → exit; the upload is a separate concern.
- `file_size_bytes` is the measured bytes on disk (what actually crossed the wire in that
  duration), falling back to the probed `expectedBytes`. The backend rejects a non-positive
  size — it would skew every later estimate — so a job with neither sends nothing.
- A non-zero exit sends nothing: a truncated download is not a valid duration sample.
- Fire-and-forget and fully swallowed; it must never be able to fail a download.

## Endpoints

`GET /events` — SSE stream of the contentless `job:change` ping above.
`GET /jobs` — every non-evicted job (the single source of truth).

```json
{ "id": "…", "status": "running", "course": "…", "lecture": "…", "kind": "lecture",
  "tool": "curl", "ref": "…", "operation": "download:curl", "expectedBytes": 6291456,
  "startedAt": 1784540024714, "message": null }
```

`operation` (`'download:curl'|'download:ytdlp'|null`) is derived from `tool` via
`services/timing.js`'s `OPERATIONS` map — null while queued before the tool is known.

`ref` (`string|null`) is the discovery-row id that spawned the job; jobs sharing a `ref`
group under one row, so a zoom before/after-break pair (`<name>.1`/`<name>.2`) stays together.

The frontend subscribes to `/events` and refetches `/jobs` here on every ping; CORS allows
the extension origin and the frontend origin (`EXTENSION_ID` / `FRONTEND_URL`).
