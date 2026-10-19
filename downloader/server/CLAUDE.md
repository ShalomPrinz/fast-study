# CLAUDE.md — downloader/server

The local server for downloading videos and documents. It holds no disk conventions of its own: it
captures a video (curl header replay or yt-dlp) or receives a PDF, then hands the bytes to the
**database** (8001), which writes them under `DATA_ROOT`. It tells the **backend** (8000) that a
video arrived and posts download duration samples to it, and calls **auto/** (3053) to resolve a
discovery row into download targets — and to re-resolve one whose cached token went stale.

## Run

```bash
npm --prefix downloader/server start   # node src/index.js, loopback-only on port 3052
npm --prefix downloader/server test    # node --test, pure logic plus loopback fakes (the only child is node)
```

A dev run needs `yt-dlp` and `curl` on PATH. Both resolve through
[`@faststudy/tools`](../../lib/tools/CLAUDE.md), are probed once at startup and reported on
`GET /tools`, which answers once that probe settles (`/health` never waits on it); a missing one fails only the downloads that need it. Packaged, this service
alone seeds and self-updates the writable yt-dlp copy ([DOWNLOAD.md](docs/DOWNLOAD.md)).

## Config (repo-root `.env`; all optional)

| Key                       | Default                 | Meaning                                                                                  |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `DOWNLOADER_PORT`         | `3052`                  | default listen port (`FASTSTUDY_PORT` in the environment wins)                           |
| `FRONTEND_URL`            | `http://localhost:5173` | frontend CORS origin; `app://bundle` always, and any `http://localhost:<port>` in dev, beside it |
| `DATABASE_URL`            | `http://localhost:8001` | database base URL                                                                        |
| `BACKEND_URL`             | `http://localhost:8000` | backend base URL — timing samples and the video-arrived report                          |
| `AUTODL_URL`              | `http://localhost:3053` | auto/ base URL — `POST /resolve`, for `/download-item`, `/download-url` and silent re-resolve, and the Moodle files auto/ streams |

CORS always allowlists `chrome-extension://<EXTENSION_ID>`, the ID the extension's manifest `key`
pins (`config.js`). That is a backstop: the extension's `<all_urls>` host permission already exempts
its calls from CORS. It learns this service's port and `FASTSTUDY_SECRET` from `electron/`'s native
host ([extension/CLAUDE.md](../extension/CLAUDE.md)).

Launch contract — the `FASTSTUDY_SECRET` check (`requireSecret`, every route but `/health`), the
secret on outbound peer calls (`peerHeaders`) and the state root (`statePath`, where yt-dlp's cache
and writable copy and the general folder's `general-folder.json` live) — comes from [`@faststudy/runtime`](../../lib/runtime/CLAUDE.md).
`peerHeaders` goes on calls to our own services only, never on `services/probe.js`'s fetch of an
external lecture host.

auto/ holds one Moodle lock ([auto GATE.md](../auto/docs/GATE.md)). A user's `/download-item` or `/download-url`
goes to auto/ unmarked, so a busy lock comes back `429 moodle_busy` and is forwarded; every call this server
makes on its own — a section run's rows, a silent re-resolve, a Moodle file fetch — sends
`X-FastStudy-Moodle-Wait: 1` and queues instead, for as long as auto/ holds it: `/resolve` goes over
`node:http`, not `fetch`, whose 300s headers timeout would kill a row queued behind a login. A file
on the Moodle host has a path on auto/ (`/moodle/file/<id>`) as its target, resolved against
`AUTODL_URL`; the `fetch` and `curl` downloaders send it the secret and the wait header from a
`-H @file` in the job's temp dir, so the secret never sits on argv.

Errors go to Sentry only when the launcher sets `FASTSTUDY_SENTRY_DSN`: `src/instrument.js`, index.js's
first import, inits with [`@faststudy/sentry`](../../lib/sentry/CLAUDE.md)'s scrubbing options, and
Sentry's express handler sits before ours. What reaches it: uncaught exceptions, unhandled rejections
(still fatal) and 5xx route errors — a failed download job is a job status, never an event.
Sending also needs the user's error-reports switch: `FASTSTUDY_ERROR_REPORTS=1` at launch, then
`POST /config {error_reports}` flips it live through the gated transport — never a re-init.

## Endpoints

| Method + path                             | Purpose                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET  /health`                            | `{status:'ok'}` at once — what the launcher waits on                                                              |
| `GET  /tools`                             | `{tools}` once the boot probe settles — the frontend's broken-tool toasts                                         |
| `POST /config`                            | `{error_reports?}` → `{status:'ok', applied}`; 400 `invalid_request` on a non-boolean — the launcher's live switch |
| `GET  /courses`                           | database `/tree` reshaped to name arrays, archived dropped                                                        |
| `POST /probe-size`                        | `{url, headers}` → `{bytes}` (HEAD → ranged GET)                                                                  |
| `POST /download`                          | curl header-replay capture; creates a missing course first; 200 with a `jobId`, runs in the background; `dest:'folder'` + `fileName` saves into the general folder instead ([DOWNLOAD.md](docs/DOWNLOAD.md)) |
| `POST /download-file`                     | plain-URL capture added to the lecture's materials; 200 at once with a `jobId`                                    |
| `POST /download-youtube`                  | yt-dlp capture (YouTube + public Google Drive file links); creates a missing course first; 200 with a `jobId`; takes `dest:'folder'` like `/download` |
| `POST /download-url`                      | any http(s) URL (the Downloads page's manual entry) → auto/ `/resolve`, then one job: plain yt-dlp off the Moodle site, curl on auto's proxy on it; auto's refusals forwarded verbatim; 200 with a `jobId` ([DOWNLOAD.md](docs/DOWNLOAD.md)) |
| `POST /download-item`                     | `{ref, course, name, kind}` → auto/ `/resolve`, then a job per target; `{media, jobIds, renames, captchaSolved?}` — `captchaSolved:true` relayed from auto when the zoom capture waited for the user to solve a captcha on screen (auto's 4xx forwarded verbatim, `429 moodle_busy` included) |
| `POST /download-section`                  | `{sectionId, course, targets}` → `{runId, renames}`; drives or joins that section's bulk run                      |
| `POST /runs/:id/resume`                   | continue a run parked at a passcode gate; `{skip:true}` gives up on the gated row                                 |
| `POST /runs/:id/cancel`                   | abandon the rest of a run and cancel every job it started (each ends `cancelled`)                                 |
| `GET  /events`                            | SSE: contentless `job:change` / `run:change` ping per transition; a `?picker=1` stream also gets `folder:pick {folder}`, asking that window for a folder |
| `POST /jobs/:id/cancel`                   | cancel one job (app or folder; it ends `cancelled`) → `{}`; `404 job_unknown` for an unknown id                    |
| `GET  /jobs`                              | `{boot, jobs}` — every live download job plus a per-process boot id; the resync for `job:change`                  |
| `GET  /runs`                              | every current section run, one per `sectionId` — the resync for `run:change`                                      |
| `POST /upload-pdf?course=&lecture=&kind=` | forward raw PDF bytes to the database's appending `/materials`; creates a missing course first; `?dest=folder&fileName=` writes them into the general folder → `{folder, fileName}` |
| `GET  /general-folder`                    | `{folder}` — where general-mode downloads land; `~/Downloads` until one is chosen                                |
| `POST /general-folder`                    | `{folder}` (absolute, existing, writable) persists it → `{folder}`; else 400 with a typed code                    |
| `POST /general-folder/pick`               | broadcasts `folder:pick` to picker streams → `{status:'ok'}`; `409 folder_picker_unavailable` when no `/events?picker=1` stream is open |

`kind` is `lecture` (default) or `recitation`.

## Module layout

`downloaders/` holds one descriptor per source — `curl` (header replay), `ytdlp`, `fetch` (plain
URL) — run by the source-agnostic `runner.js`. `jobs.js` is the job registry, `runs.js` the
section-run registry + queue driver (it calls `downloadItem` directly, not over HTTP), and
`events.js` the SSE fan-out for both. `generalFolder.js` is general mode's folder, naming and move.
All `DATABASE_URL` I/O goes through `services/database.js`.

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
- Saved video is always `video.mp4` (general mode excepted: a user-named file in a user folder); PDFs are POSTed to the database's `/materials`, which allocates
  the name (`material.pdf`, `material.2.pdf`, …), so a lecture can hold several.
- Add a download source = a new `downloaders/*.js` + one registry line; never edit the runner.
- HTTP goes through `fetch` (the one exception is `/resolve`, above). Node's `fetch` has no forbidden-header list, so it replays a captured
  `Cookie`, and drops it on a cross-origin redirect on its own.
- Every non-2xx body and every failed job carries `{code, params}` beside its English prose
  ([downloader CLAUDE.md](../CLAUDE.md)); a rejected request is `invalid_request` with the `field`.
