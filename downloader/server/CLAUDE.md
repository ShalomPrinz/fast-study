# CLAUDE.md — downloader/server

The local server for downloading videos and documents. It has no disk conventions of its
own: it captures a video (curl header-replay or yt-dlp) or receives a PDF, then hands the bytes to the **database service** (8001), which writes them under
`DATA_ROOT`. It also posts download duration samples to the **backend** (8000) — its only
other outbound edge (`docs/JOBS.md`).

## Tech Stack

Node.js: Express + cors + dotenv; subprocesses via `node:child_process`.

## Run

```bash
npm --prefix downloader/server start   # node src/index.js, port 3052
```

`yt-dlp` and `curl` must be installed system-wide (the server shells out to them).

## Config (repo-root `.env`, all optional)

| Key                      | Default                              | Meaning                          |
|--------------------------|--------------------------------------|----------------------------------|
| `DOWNLOADER_PORT`        | `3052`                               | listen port                      |
| `DOWNLOADER_EXTENSION_ID`| `lnhmnpikihooldojjihejacblbgjkdlg`   | extension CORS origin            |
| `FRONTEND_URL`           | `http://localhost:5173`              | frontend CORS origin (`/events` + `/jobs`) |
| `DATABASE_URL`           | `http://localhost:8001`              | database service base URL        |
| `BACKEND_URL`            | `http://localhost:8000`              | backend base URL — timing samples only |

If a reloaded extension gets a new ID, set `DOWNLOADER_EXTENSION_ID` or CORS blocks
the popup.

## Endpoints

| Method + path                          | Purpose                                                        |
|----------------------------------------|----------------------------------------------------------------|
| `GET  /courses`                        | database `/tree` reshaped to name arrays, archived dropped     |
| `POST /probe-size`                     | `{url, headers}` → `{bytes}` (HEAD → ranged-GET, raw http)     |
| `POST /download`                       | curl header-replay capture; 200 immediately with a `jobId`, runs in background |
| `POST /download-youtube`               | yt-dlp capture (YouTube + public Google Drive file hosts); 200 immediately with a `jobId` |
| `GET  /events`                         | SSE: `job:start` / `job:end` per download (`docs/JOBS.md`)      |
| `GET  /jobs`                           | all live download jobs — the resync for a late subscriber       |
| `GET  /jobs/:id`                       | one download job, 404 if unknown/evicted                       |
| `POST /upload-pdf?course=&lecture=&kind=` | forward raw PDF bytes to the neutral `/files/material.pdf`   |

`kind` is `lecture` (default) or `recitation`.

## Module layout

```
src/
  index.js             entry: express app (cors, json, routers, error handler) + listen
  config.js            env + PORT / EXTENSION_ID / FRONTEND_URL / DATABASE_URL / filenames
  validate.js          isSafeName, validateKind
  progress.js          active-download registry + TTY/pipe progress rendering
  jobs.js              job registry over the same download entries (the state)
  events.js            SSE fan-out of job:start / job:end (the notification)
  routes/              courses, probe, download, pdf, jobs (+ /events)
  services/
    database.js        all DATABASE_URL I/O (listCourses, uploadVideo, uploadPdf, notify)
    probe.js           probeContentLength — the ONLY raw node:http/https
    timing.js          fire-and-forget duration samples to the backend's POST /timing
  downloaders/
    index.js           registry { curl, ytdlp } + runDownloadJob
    runner.js          source-agnostic spawn/probe/upload loop
    curl.js  ytdlp.js  one module per source
```

Deep rationale lives in `docs/`: `DOWNLOAD.md` (header replay, SKIP_HEADERS, yt-dlp
DASH + JS-runtime, size probe), `PROGRESS.md` (silent children, TTY vs pipe, curl-file
vs yt-dlp-dir measure), `JOBS.md` (job lifecycle, event stream vs resync,
`done` = uploaded, per-tool timing samples), `DATABASE.md` (video PUT wipes derived artifacts vs neutral
`/files/`, `/tree` reshape, notify ping).

## Conventions

- ESM only (`import`, never `require`); deps are express + cors + dotenv.
- Subprocesses via `execFile`/`spawn` with **argv arrays, never shell strings** — a
  captured header value must not be able to inject.
- Saved video is always `video.mp4`, uploaded PDF always `material.pdf` (`config.js`).
- Add a download source = new `downloaders/*.js` + one registry line; don't edit the runner.
- The size probe stays on raw `node:http` because it replays the `Cookie` header that
  `fetch` forbids — do not "modernize" it to fetch.
- Docs/comments describe the **current state and durable WHY** — never plans, phased
  steps, or "how we got here" history.
