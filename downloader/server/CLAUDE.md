# CLAUDE.md — downloader/server

The local server for downloading videos and documents. It has no disk conventions of its
own: it captures a video (curl header-replay or yt-dlp) or receives a PDF, then hands the bytes to the **database service** (8001), which writes them under
`DATA_ROOT`. It tells the **backend** (8000) that a video arrived and posts download duration
samples to it, and calls **auto/** (3053) to resolve a discovery row into download targets — and
to re-resolve one whose cached token went stale (`docs/JOBS.md`).

## Run

```bash
npm --prefix downloader/server start   # node src/index.js, loopback-only on port 3052
npm --prefix downloader/server test    # node --test, pure logic only (no network, no subprocess)
```

`yt-dlp` and `curl` must be installed system-wide for a dev run (the server shells out to them).
Both are spawned through `toolPath(name)` from `@faststudy/tools`: `FASTSTUDY_BIN_DIR` set means an
absolute path into the shipped binaries, unset means PATH. `curl` is the exception that stays a PATH
lookup either way — Windows 10+ ships `curl.exe`, so it is deliberately not bundled. Both are probed
once at startup and reported on `/health` as `tools`; a missing one fails only the downloads that
need it.

## Config (repo-root `.env`; all optional except as noted)

| Key                       | Default                            | Meaning                                                                      |
| ------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `DOWNLOADER_PORT`         | `3052`                             | default listen port (`FASTSTUDY_PORT` in the environment wins)               |
| `DOWNLOADER_EXTENSION_ID` | none — no extension origin         | extension CORS origin; required to use the dev-only extension                |
| `FRONTEND_URL`            | `http://localhost:5173`            | frontend CORS origin (downloads, `/events`, `/jobs`, `/runs`); the packaged app's `app://bundle` is always allowed alongside it |
| `DATABASE_URL`            | `http://localhost:8001`            | database service base URL                                                    |
| `BACKEND_URL`             | `http://localhost:8000`            | backend base URL — timing samples and the video-arrived report               |
| `AUTODL_URL`              | `http://localhost:3053`            | auto/ base URL — `POST /resolve`, for `/download-item` and silent re-resolve |

`DOWNLOADER_EXTENSION_ID` has no default: unset, no `chrome-extension://` origin is allowlisted
at all, which is what a packaged build always is. The extension is dev-only — it hardcodes
`http://localhost:3052` against an ephemeral port and has no bridge to receive `FASTSTUDY_SECRET` —
so a dev must set this to the ID Chrome assigned (it changes on reload) or CORS blocks the popup.

`FASTSTUDY_SECRET` (environment, not `.env` — the launcher sets it) gates every route but
`/health`: `requireSecret` from `@faststudy/runtime` (the shared launch-contract package at `lib/runtime/`
in the repo root) rejects a request lacking the `X-FastStudy-Secret` header or
`?secret=`, and its `peerHeaders` adds the header to every outbound call to a peer —
never to `services/probe.js`, which fetches an external lecture host. Unset means no enforcement.

`@faststudy/runtime`'s `statePath` returns the per-user writable state root — `FASTSTUDY_STATE_DIR` when set,
else `.state/` at the repo root. It is where yt-dlp's `--cache-dir` points, and it only joins the
path; each writer creates its own directory.

## Endpoints

| Method + path                             | Purpose                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET  /health`                            | `{status:'ok', tools}` — liveness plus the boot-time binary probe, what the launcher waits on before opening the window                          |
| `GET  /courses`                           | database `/tree` reshaped to name arrays, archived dropped                                                                                        |
| `POST /probe-size`                        | `{url, headers}` → `{bytes}` (HEAD → ranged-GET)                                                                                                  |
| `POST /download`                          | curl header-replay capture; 200 immediately with a `jobId`, runs in background                                                                    |
| `POST /download-file`                     | plain-URL (no header replay) capture added to the lecture's materials; 200 immediately with a `jobId`                                             |
| `POST /download-youtube`                  | yt-dlp capture (YouTube + public Google Drive file hosts); 200 immediately with a `jobId`                                                         |
| `POST /download-item`                     | `{ref, course, name, kind}` → auto/ `/resolve`, then a job per target; `{media, jobIds, renames}` (auto's 4xx forwarded verbatim)                 |
| `POST /download-section`                  | `{sectionId, course, targets}` → `{runId, renames}`; drives that section's bulk queue in the background, or joins its active run (`docs/RUNS.md`) |
| `POST /runs/:id/resume`                   | continue a run parked at a passcode gate; `{skip:true}` gives up on the gated row                                                                 |
| `POST /runs/:id/cancel`                   | abandon the rest of a run                                                                                                                         |
| `GET  /events`                            | SSE: contentless `job:change` / `run:change` ping per transition (`docs/JOBS.md`, `docs/RUNS.md`)                                                 |
| `GET  /jobs`                              | all live download jobs (snapshot includes `ref`) — the single source of truth                                                                     |
| `GET  /runs`                              | every current section run, one per `sectionId` — the resync for `run:change`                                                                      |
| `POST /upload-pdf?course=&lecture=&kind=` | forward raw PDF bytes to the database's appending `/materials`                                                                                    |

`kind` is `lecture` (default) or `recitation`.

## Module layout

`downloaders/` holds one descriptor per source — `curl` (header replay), `ytdlp`, and `fetch` (plain
URL). Each names its own `upload` (required): `uploadVideo` for the two video sources, `uploadMaterial` for `fetch`.
`jobs.js` is the state (job registry over the download entries) and `runs.js` the state one level up
(section-run registry + the queue driver, which calls `downloadItem` directly rather than over HTTP);
`events.js` is the notification for both (SSE fan-out of the contentless `job:change` / `run:change`
pings). All `DATABASE_URL` I/O goes through `services/database.js`, which also announces a stored
video to the backend (`services/backend.js`).

Deep rationale lives in `docs/`: `DOWNLOAD.md` (header replay, SKIP_HEADERS, yt-dlp
DASH + JS-runtime, size probe), `PROGRESS.md` (silent children, TTY vs pipe, curl-file
vs yt-dlp-dir measure), `JOBS.md` (job lifecycle, event stream vs resync,
`done` = uploaded, per-tool timing samples), `RUNS.md` (one run per section, dispositions, the
indefinite passcode pause, the caller-owned skip rule, the `RunTarget` cross-wire contract),
`DATABASE.md` (video PUT wipes derived artifacts vs the
appending `/materials` POST, `/tree` reshape, notify ping).

## Conventions

- ESM only (`import`, never `require`).
- Subprocesses via `execFile`/`spawn` with **argv arrays, never shell strings** — a
  captured header value must not be able to inject.
- Every course/lecture name arriving at a route goes through `validate.js::storedName`, which
  rejects traversal and then rewrites the rest into the spelling the database stores (a port of
  `database/fs/paths.py::safe_name` — change one, change the other); `null` is a 400. What it
  rewrote is reported back as `renames` by `/download-item` and `/download-section`.
- Saved video is always `video.mp4` (`config.js`); PDFs are POSTed to the database's
  `/materials`, which allocates the name (`material.pdf`, `material.2.pdf`, …) — the server
  never names a material, so a lecture can hold several.
- Add a download source = new `downloaders/*.js` + one registry line; don't edit the runner.
- HTTP goes through `fetch`. Node's `fetch` has no forbidden-header list, so it replays a
  captured `Cookie` and drops it on a cross-origin redirect on its own.
