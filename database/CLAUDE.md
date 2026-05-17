# CLAUDE.md — database

## What this is

FastAPI service that owns every read, write, and listing under `DATA_ROOT`, plus the cross-service SSE notify channel. The frontend, downloader, and backend all talk to this service for filesystem state — no other service touches disk directly.

Behavior is a verbatim port of the old `frontend/fs-api/handlers/*` middleware — same path conventions, same response shapes, same error semantics. No logic changes vs. the pre-refactor implementation.

## Directory layout

```
database/
  main.py              FastAPI app + uvicorn entry
  fs/
    paths.py             data_root, course_dir, lecture_dir(course, lecture, kind), RECITATIONS_DIR
    tree.py              read_tree, read_course (port of frontend fs-reader.ts)
    summary.py           read/write/revert summary.md
    files.py             resolve a lecture file path for streaming
    crud.py              create/rename course / lecture, upload video, delete file
  events/
    sse.py               in-memory pub/sub: subscribe() async generator + broadcast_notify()
  pyproject.toml
```

## Environment

Reads the repo-root `.env` (via `python-dotenv`). Required:

- `DATA_ROOT` — absolute path to the data directory.

## Running

```bash
cd database
uvicorn main:app --reload --port 8001    # dev (port 8001)
python3 main.py                          # also works, same port
```

`npm run dev` from the repo root brings this up alongside Backend / Frontend / Downloader.

## Ports

`8001`. (`backend=8000`, `frontend=5173`, `downloader=3052`.)

## API surface

| Method+Path                                                              | Purpose                                  |
|--------------------------------------------------------------------------|------------------------------------------|
| `GET    /tree`                                                           | full course tree                         |
| `GET    /courses/{course}`                                               | single course refresh                    |
| `POST   /courses`                                                        | create course (body: `{name}`)           |
| `PATCH  /courses/{course}`                                               | rename course (body: `{name}`)           |
| `POST   /courses/{course}/lectures?kind=lecture\|recitation`             | create lecture (body: `{name}`)          |
| `PATCH  /courses/{course}/lectures/{lecture}?kind=...`                   | rename lecture (body: `{name}`)          |
| `PUT    /courses/{course}/lectures/{lecture}/video?kind=...`             | upload `video.mp4` (raw body), wipes derived artifacts |
| `PUT    /courses/{course}/lectures/{lecture}/files/{name}?kind=...`      | write a single file (raw body); neutral — no artifact wipe |
| `HEAD   /courses/{course}/lectures/{lecture}/files/{name}?kind=...`      | 200 if file exists, 404 otherwise        |
| `DELETE /courses/{course}/lectures/{lecture}/files/{name}?kind=...`      | delete a single file in the lecture dir  |
| `GET    /courses/{course}/lectures/{lecture}/summary?kind=...`           | read `summary.md` + `hasOriginal` flag   |
| `PUT    /courses/{course}/lectures/{lecture}/summary?kind=...`           | write `summary.md` (raw utf-8 body)      |
| `DELETE /courses/{course}/lectures/{lecture}/summary?kind=...`           | revert to `original_summary.md`          |
| `GET    /courses/{course}/lectures/{lecture}/files/{name}?kind=...`      | stream a lecture file                    |
| `GET    /events`                                                         | SSE stream of `notify` events            |
| `POST   /notify`                                                         | broadcast a `notify` event to subscribers|

`kind` defaults to `lecture`; pass `?kind=recitation` to address recitations.

## Key design decisions

- **All path conventions live here.** `lecture_dir(course, lecture, kind)` in `fs/paths.py` is the single source of truth for resolving paths under `DATA_ROOT`. The on-disk layout (`{DATA_ROOT}/{course}/{lecture}/...` and `{DATA_ROOT}/{course}/Recitations/{name}/...`) is not re-encoded anywhere else — other services pass `(course, lecture, kind)` tuples and let this service resolve them.
- **`PUT /…/video` auto-triggers backend's `/run/audio`.** After a successful video write, the endpoint fire-and-forgets a POST to `${BACKEND_URL}/courses/{c}/lectures/{l}/run/audio?kind=...` (default `BACKEND_URL=http://localhost:8000`) so a downloader upload starts the audio-extraction step without a frontend click. Failures are logged and swallowed; the PUT response returns as soon as bytes hit disk.
- **`PUT /…/video` wipes derived artifacts; `PUT /…/files/{name}` does not.** The video endpoint is the downloader's fresh-upload path and intentionally erases stale audio/transcript/summary. The generic files endpoint is the backend pipeline's write path for `audio.mp3`, `transcript.txt`, `transcript.partial.*`, `summary.pdf`, `drive_url.txt` — wiping would erase prior pipeline outputs mid-run. Summary writes go through the dedicated `/summary` endpoint, which snapshots the pre-edit original on first write.
- **SSE lives here.** `/events` is a long-lived `text/event-stream` response; each subscriber gets its own `asyncio.Queue`. `/notify` fans an `event: notify` message out to every queue. Producers (today: the downloader, after a successful download) fire-and-forget — failure to deliver is silent and non-blocking, same contract as the previous Vite-plugin handler.
- **CORS open to `http://localhost:5173`.** Backend and downloader call this service server-to-server, so no CORS entry is needed for them.
- **No auth.** Localhost-only trust model.

## Documentation

Every `def` / `async def` across database servoce `*.py` files has a one-line docstring as its first statement describing intent (not mechanics). A few carry an extra line when the WHY isn't obvious from the code — e.g. `_read_transcribe_partial` swallowing parse errors, `write_summary` snapshotting the pre-edit original on first write, `write_video` wiping derived artifacts, `broadcast_notify` being fire-and-forget.

**Maintain documentation on each change.** When adding a new function, give it a docstring in the same style. When changing a function's behavior, update its docstring.
