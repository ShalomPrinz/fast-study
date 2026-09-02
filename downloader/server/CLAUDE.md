# CLAUDE.md — downloader/server

The local server for downloading videos and documents. It has no disk conventions of its
own: it captures a video (curl header-replay or yt-dlp) or receives a PDF, then hands the bytes to the **database service** (8001), which writes them under
`DATA_ROOT`. It tells the **backend** (8000) that a video arrived and posts download duration
samples to it, and calls **auto/** (3053) to resolve a discovery row into download targets — and
to re-resolve one whose cached token went stale (`docs/JOBS.md`).

## Run

```bash
npm --prefix downloader/server start   # node src/index.js, port 3052
npm --prefix downloader/server test    # node --test, pure logic only (no network, no subprocess)
```

`yt-dlp` and `curl` must be installed system-wide (the server shells out to them).

## Config (repo-root `.env`, all optional)

| Key                       | Default                            | Meaning                                                                     |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `DOWNLOADER_PORT`         | `3052`                             | listen port                                                                 |
| `DOWNLOADER_EXTENSION_ID` | `lnhmnpikihooldojjihejacblbgjkdlg` | extension CORS origin                                                       |
| `FRONTEND_URL`            | `http://localhost:5173`            | frontend CORS origin (downloads, `/events`, `/jobs`, `/runs`)               |
| `DATABASE_URL`            | `http://localhost:8001`            | database service base URL                                                   |
| `BACKEND_URL`             | `http://localhost:8000`            | backend base URL — timing samples and the video-arrived report              |
| `AUTODL_URL`              | `http://localhost:3053`            | auto/ base URL — `POST /resolve`, for `/download-item` and silent re-resolve |

If a reloaded extension gets a new ID, set `DOWNLOADER_EXTENSION_ID` or CORS blocks
the popup.

## Endpoints

| Method + path                             | Purpose                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET  /health`                            | liveness only — what the launcher waits on before opening the window                                                   |
| `GET  /courses`                           | database `/tree` reshaped to name arrays, archived dropped                                                             |
| `POST /probe-size`                        | `{url, headers}` → `{bytes}` (HEAD → ranged-GET)                                                                       |
| `POST /download`                          | curl header-replay capture; 200 immediately with a `jobId`, runs in background                                        |
| `POST /download-file`                     | plain-URL (no header replay) capture added to the lecture's materials; 200 immediately with a `jobId`                  |
| `POST /download-youtube`                  | yt-dlp capture (YouTube + public Google Drive file hosts); 200 immediately with a `jobId`                             |
| `POST /download-item`                     | `{ref, course, name, kind}` → auto/ `/resolve`, then a job per target; `{media, jobIds, renames}` (auto's 4xx forwarded verbatim) |
| `POST /download-section`                  | `{sectionId, course, targets}` → `{runId, renames}`; drives that section's bulk queue in the background, or joins its active run (`docs/RUNS.md`) |
| `POST /runs/:id/resume`                   | continue a run parked at a passcode gate; `{skip:true}` gives up on the gated row                                       |
| `POST /runs/:id/cancel`                   | abandon the rest of a run                                                                                              |
| `GET  /events`                            | SSE: contentless `job:change` / `run:change` ping per transition (`docs/JOBS.md`, `docs/RUNS.md`)                       |
| `GET  /jobs`                              | all live download jobs (snapshot includes `ref`) — the single source of truth                                          |
| `GET  /runs`                              | every current section run, one per `sectionId` — the resync for `run:change`                                            |
| `POST /upload-pdf?course=&lecture=&kind=` | forward raw PDF bytes to the database's appending `/materials`                                                         |

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
