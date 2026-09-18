# CLAUDE.md — downloader/server

The local server for downloading videos and documents. It holds no disk conventions of its own: it
captures a video (curl header replay or yt-dlp) or receives a PDF, then hands the bytes to the
**database** (8001), which writes them under `DATA_ROOT`. It tells the **backend** (8000) that a
video arrived and posts download duration samples to it, and calls **auto/** (3053) to resolve a
discovery row into download targets — and to re-resolve one whose cached token went stale.

## Run

```bash
npm --prefix downloader/server start   # node src/index.js, loopback-only on port 3052
npm --prefix downloader/server test    # node --test, pure logic only (no network, no subprocess)
```

A dev run needs `yt-dlp` and `curl` on PATH. Both resolve through
[`@faststudy/tools`](../../lib/tools/CLAUDE.md), are probed once at startup and reported on
`/health` as `tools`; a missing one fails only the downloads that need it. Packaged, this service
alone seeds and self-updates the writable yt-dlp copy ([DOWNLOAD.md](docs/DOWNLOAD.md)).

## Config (repo-root `.env`; all optional)

| Key                       | Default                 | Meaning                                                                                  |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `DOWNLOADER_PORT`         | `3052`                  | default listen port (`FASTSTUDY_PORT` in the environment wins)                           |
| `DOWNLOADER_EXTENSION_ID` | none                    | extension CORS origin — required to use the dev-only extension                          |
| `FRONTEND_URL`            | `http://localhost:5173` | frontend CORS origin; the packaged `app://bundle` is always allowed beside it            |
| `DATABASE_URL`            | `http://localhost:8001` | database base URL                                                                        |
| `BACKEND_URL`             | `http://localhost:8000` | backend base URL — timing samples and the video-arrived report                          |
| `AUTODL_URL`              | `http://localhost:3053` | auto/ base URL — `POST /resolve`, for `/download-item` and silent re-resolve             |

`DOWNLOADER_EXTENSION_ID` has no default, so a packaged build allowlists no `chrome-extension://`
origin. The extension is dev-only — it hardcodes `http://localhost:3052` and has no way to receive
`FASTSTUDY_SECRET` — so a dev sets this to the ID Chrome assigned (it changes on reload) or CORS
blocks the popup.

Launch contract — the `FASTSTUDY_SECRET` check (`requireSecret`, every route but `/health`), the
secret on outbound peer calls (`peerHeaders`) and the state root (`statePath`, where yt-dlp's cache
and writable copy live) — comes from [`@faststudy/runtime`](../../lib/runtime/CLAUDE.md).
`peerHeaders` goes on calls to our own services only, never on `services/probe.js`'s fetch of an
external lecture host.

## Endpoints

| Method + path                             | Purpose                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET  /health`                            | `{status:'ok', tools}` — what the launcher waits on                                                               |
| `GET  /courses`                           | database `/tree` reshaped to name arrays, archived dropped                                                        |
| `POST /probe-size`                        | `{url, headers}` → `{bytes}` (HEAD → ranged GET)                                                                  |
| `POST /download`                          | curl header-replay capture; 200 at once with a `jobId`, runs in the background                                    |
| `POST /download-file`                     | plain-URL capture added to the lecture's materials; 200 at once with a `jobId`                                    |
| `POST /download-youtube`                  | yt-dlp capture (YouTube + public Google Drive file links); 200 at once with a `jobId`                             |
| `POST /download-item`                     | `{ref, course, name, kind}` → auto/ `/resolve`, then a job per target; `{media, jobIds, renames}` (auto's 4xx forwarded verbatim) |
| `POST /download-section`                  | `{sectionId, course, targets}` → `{runId, renames}`; drives or joins that section's bulk run                      |
| `POST /runs/:id/resume`                   | continue a run parked at a passcode gate; `{skip:true}` gives up on the gated row                                 |
| `POST /runs/:id/cancel`                   | abandon the rest of a run                                                                                         |
| `GET  /events`                            | SSE: contentless `job:change` / `run:change` ping per transition                                                  |
| `GET  /jobs`                              | every live download job — the resync for `job:change`                                                             |
| `GET  /runs`                              | every current section run, one per `sectionId` — the resync for `run:change`                                      |
| `POST /upload-pdf?course=&lecture=&kind=` | forward raw PDF bytes to the database's appending `/materials`                                                    |

`kind` is `lecture` (default) or `recitation`.

## Module layout

`downloaders/` holds one descriptor per source — `curl` (header replay), `ytdlp`, `fetch` (plain
URL) — run by the source-agnostic `runner.js`. `jobs.js` is the job registry, `runs.js` the
section-run registry + queue driver (it calls `downloadItem` directly, not over HTTP), and
`events.js` the SSE fan-out for both. All `DATABASE_URL` I/O goes through `services/database.js`.

| Doc                                | Concern                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| [DOWNLOAD.md](docs/DOWNLOAD.md)    | header replay and `SKIP_HEADERS`, yt-dlp's JS runtime, the writable copy + self-update, size probe |
| [JOBS.md](docs/JOBS.md)            | job lifecycle, `done` = uploaded, silent auth recovery, event stream vs resync, retention, timing samples |
| [RUNS.md](docs/RUNS.md)            | one run per section, dispositions, the indefinite passcode pause, the caller-owned skip rule, `RunTarget` |
| [DATABASE.md](docs/DATABASE.md)    | video PUT wipes derived artifacts vs appending `/materials`, `/tree` reshape, notify, arrival report |

## Terminal progress (`src/progress.js`)

Children run **silent** (curl `--silent`, yt-dlp `--no-progress`) and the server is the sole
terminal writer: two children's own `\r` bars on one terminal stomp each other and our logs. One
shared ~1.5s interval measures each temp dir against the probed total — curl's lone `video.mp4` is
stat'ed (`measure:'file'`); yt-dlp writes separate audio/video files before merging, so the whole
dir is summed (`measure:'dir'`) and percent is clamped ≤99% until exit, since the merge can overshoot.

- **TTY** (`npm start`) repaints a compact block in place via ANSI.
- **Pipe** (`npm run dev` under `concurrently`, every line prefixed `Downloader |`) makes ANSI
  garbage, so it prints a throttled whole line per ≥5% or ~8s.

Every lifecycle log goes through `emitLog`/`emitError`, which wipe the painted block first. Stderr
is not inherited, so `makeStderrTail` keeps the last ~64 KB and a failure reports its last 15 lines.
These bytes are terminal-only; the job registry reads the same entries but pushes only transitions.

## Conventions

- ESM only (`import`, never `require`).
- Subprocesses via `execFile`/`spawn` with **argv arrays, never shell strings** — a captured header
  value must not be able to inject.
- Every course/lecture name arriving at a route goes through `validate.js::storedName`, which rejects
  traversal and rewrites the rest into the spelling the database stores (a port of
  `database/fs/paths.py::safe_name` — change one, change the other); `null` is a 400. What it
  rewrote comes back as `renames` from `/download-item` and `/download-section`.
- Saved video is always `video.mp4`; PDFs are POSTed to the database's `/materials`, which allocates
  the name (`material.pdf`, `material.2.pdf`, …), so a lecture can hold several.
- Add a download source = a new `downloaders/*.js` + one registry line; never edit the runner.
- HTTP goes through `fetch`. Node's `fetch` has no forbidden-header list, so it replays a captured
  `Cookie`, and drops it on a cross-origin redirect on its own.
