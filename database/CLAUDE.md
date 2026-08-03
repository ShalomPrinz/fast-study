# CLAUDE.md — database

## What this is

FastAPI service that owns every read, write, and listing under `DATA_ROOT`, plus the cross-service SSE notify channel. The frontend, downloader, and backend all talk to this service for filesystem state — no other service touches disk directly.

Behavior is a verbatim port of the old `frontend/fs-api/handlers/*` middleware — same path conventions, same response shapes, same error semantics. No logic changes vs. the pre-refactor implementation.

## Directory layout

```
database/
  main.py              FastAPI app + uvicorn entry
  fs/
    paths.py             data_root, course_dir, overview_dir, lecture_dir(course, lecture, kind), RECITATIONS_DIR, OVERVIEW_DIR, ARCHIVED_MARKER, SOURCE_URL_MARKER, PDF_WARNING_MARKER, PDF_BUILD_TEX_MARKER, PREDEFINED_FILES
    tree.py              read_tree, read_course (port of frontend fs-reader.ts)
    summary.py           read/write/revert summary.md
    summaries.py         read every non-empty summary.md in a course (client-side search corpus)
    files.py             resolve a lecture file path for streaming
    crud.py              create/rename/archive course, create/rename lecture, upload video, write/delete file
    overview.py          course-level overview files: resolve path, write, list
  events/
    sse.py               in-memory pub/sub: subscribe() async generator + broadcast_notify()
  tests/                 pytest suite; conftest points DATA_ROOT at a per-test tmp dir
  pyproject.toml
```

There is deliberately **no delete path for overview files** — no `DELETE /courses/{course}/overview/files/{name}` route and no crud helper. When one is added, it must drop the pdf's `.{slug}.pdf_warning` alongside it, the way `crud.delete_file` does for `summary.pdf`.

## Environment

Reads the repo-root `.env` (via `python-dotenv`). Required:

- `DATA_ROOT` — absolute path to the data directory.
- `BACKEND_URL` (optional, default `http://localhost:8000`) — used by the auto-trigger after a video upload. See `_post_run_audio` in `main.py`.

## Running

```bash
cd database
uvicorn main:app --reload --port 8001    # dev (port 8001)
python3 main.py                          # also works, same port
```

`npm run dev` from the repo root brings this up alongside Backend / Frontend / Downloader.

## Testing

```bash
cd database && python3 -m pytest tests/ -q
```

## Ports

`8001`. (`backend=8000`, `frontend=5173`, `downloader=3052`.)

## API surface

| Method+Path                                                         | Purpose                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET    /tree`                                                      | full course tree                                                                                                          |
| `POST   /courses`                                                   | create course (body: `{name}`, optional `{source_url}`)                                                                   |
| `PATCH  /courses/{course}`                                          | rename course (body: `{name}`)                                                                                            |
| `PATCH  /courses/{course}/source_url`                               | set/clear course source_url (body: `{source_url}`; empty/null clears)                                                     |
| `PATCH  /courses/{course}/archived`                                 | archive/unarchive course (body: `{archived}`)                                                                             |
| `POST   /courses/{course}/lectures?kind=lecture\|recitation`        | create lecture (body: `{name}`)                                                                                           |
| `PATCH  /courses/{course}/lectures/{lecture}?kind=...`              | rename lecture (body: `{name}`)                                                                                           |
| `PUT    /courses/{course}/lectures/{lecture}/video?kind=...`        | upload `video.mp4` (raw body), wipes derived artifacts                                                                    |
| `PUT    /courses/{course}/lectures/{lecture}/files/{name}?kind=...` | write a single file (raw body); neutral — no artifact wipe                                                                |
| `HEAD   /courses/{course}/lectures/{lecture}/files/{name}?kind=...` | 200 if file exists, 404 otherwise                                                                                         |
| `DELETE /courses/{course}/lectures/{lecture}/files/{name}?kind=...` | delete a single file in the lecture dir (deleting `summary.pdf` also drops `.pdf_warning`)                                |
| `GET    /courses/{course}/lectures/{lecture}/summary?kind=...`      | read `summary.md` + `hasOriginal` flag                                                                                    |
| `PUT    /courses/{course}/lectures/{lecture}/summary?kind=...`      | write `summary.md` (raw utf-8 body)                                                                                       |
| `DELETE /courses/{course}/lectures/{lecture}/summary?kind=...`      | revert to `original_summary.md`                                                                                           |
| `GET    /courses/{course}/lectures/{lecture}/files/{name}?kind=...` | stream a lecture file                                                                                                     |
| `GET    /courses/{course}/summaries`                                | all non-empty `summary.md` in a course: `{summaries: [{name, kind, content}]}`; 404 if course missing                     |
| `PUT    /courses/{course}/overview/files/{name}`                    | write a course-level overview file (raw body); neutral, 404 if course missing                                             |
| `GET    /courses/{course}/overview/files`                           | list overview files: `{files: [{name, size, mtime, warning?}]}` (dotfiles excluded; empty if dir absent)                  |
| `GET    /courses/{course}/overview/files/{name}`                    | stream a course-level overview file                                                                                       |
| `GET    /courses/{course}/overview/meta`                            | read per-slug overview meta map: `{meta: {...}}` (`{}` if none)                                                           |
| `PATCH  /courses/{course}/overview/meta`                            | merge one slug's entry into `overview/meta.json` (body: `{slug, entry}`); atomic server-side merge, 404 if course missing |
| `GET    /events`                                                    | SSE stream of `notify` events                                                                                             |
| `POST   /notify`                                                    | broadcast a `notify` event to subscribers                                                                                 |

`kind` defaults to `lecture`; pass `?kind=recitation` to address recitations.

## Key design decisions

- **All path conventions live here.** `lecture_dir(course, lecture, kind)` in `fs/paths.py` is the single source of truth for resolving paths under `DATA_ROOT`. The on-disk layout (`{DATA_ROOT}/{course}/{lecture}/...` and `{DATA_ROOT}/{course}/Recitations/{name}/...`) is not re-encoded anywhere else — other services pass `(course, lecture, kind)` tuples and let this service resolve them.
- **Per-course `source_url` lives in a `.source_url` dotfile.** The auto-downloader's per-course lecture-site URL is stored in `{DATA_ROOT}/{course}/.source_url` (holds the URL text, mirroring `drive_url.txt`; a dotfile so tree iteration — dirs only — ignores it, and it survives renames like `.archived`). `read_course` surfaces it as the `source_url` field on every course node (`null` when unset, so pre-existing courses stay backwards-compatible). Set via `POST /courses` (`source_url` in the create body) or `PATCH /courses/{course}/source_url`; empty/null clears the file.
- **PDF render dotfiles live in the lecture dir.** `.pdf_warning` (`PDF_WARNING_MARKER`) holds one line of classified XeLaTeX warning text for a `summary.pdf` that rendered despite errors; `.pdf_build.tex` (`PDF_BUILD_TEX_MARKER`) holds the generated LaTeX the backend keeps only when a render fails hard. Both are dotfiles and deliberately **not** in `PREDEFINED_FILES` — they are debug/metadata, not pipeline artifacts, and must never become tree rows. `_read_lecture` inlines `.pdf_warning`'s stripped content onto the existing `summary.pdf` entry as a `warning` field (mirroring `drive_url.txt` → `url`); absent, empty, or unreadable ⇒ no `warning` key at all, never `null`.
- **Overview PDFs mirror the same warning convention, one marker per slug.** `.{slug}.pdf_warning` in the course's `overview/` dir (`overview_pdf_warning_marker(slug)` in `fs/paths.py`) holds one line of XeLaTeX warning text for `{slug}.pdf`; `list_overview_files` inlines its stripped content onto that pdf's entry as `warning` (absent/empty/unreadable ⇒ no key). The listing skips **all** dotfiles, so markers and any future metadata never become rows. The backend writes and clears the marker through the plain `PUT /…/overview/files/{name}` path — dot-prefixed names pass `_check_safe`, and an empty write clears the warning.
- **Deleting `summary.pdf` drops `.pdf_warning`.** `crud.delete_file` is the single chokepoint: a warning describes THIS pdf and can never outlive it, so backend teardown, frontend delete paths, and re-render resets all get the clear for free without clearing it themselves. `write_video`'s group wipe drops both dotfiles too.
- **`overview/` is a course-level file area, not a lecture.** Backend's overview step writes cross-lecture study files (e.g. `exam-hints.txt`) to `{DATA_ROOT}/{course}/overview/{name}` via `overview_dir(course)`. `fs/tree.py` skips this directory (like `Recitations`) so it never appears as a lecture in the tree. Writes are neutral (no artifact wipe, no side effects) and 404 if the course doesn't exist.
- **`PUT /…/video` auto-triggers backend's `/run/audio`.** After a successful video write, the endpoint fire-and-forgets a POST to `${BACKEND_URL}/courses/{c}/lectures/{l}/run/audio?kind=...` (default `BACKEND_URL=http://localhost:8000`) so a downloader upload starts the audio-extraction step without a frontend click. Failures are logged and swallowed; the PUT response returns as soon as bytes hit disk.
- **`PUT /…/video` wipes derived artifacts; `PUT /…/files/{name}` does not.** The video endpoint is the downloader's fresh-upload path and intentionally erases stale audio/transcript/summary. The generic files endpoint is the backend pipeline's write path for `audio.mp3`, `transcript.txt`, `transcript.partial.*`, `summary.pdf`, `drive_url.txt` — wiping would erase prior pipeline outputs mid-run. Summary writes go through the dedicated `/summary` endpoint, which snapshots the pre-edit original on first write.
- **Overview-meta concurrency: no lock, cooperative-scheduling atomicity + atomic write.** The read-modify-write of `overview/meta.json` in `merge_overview_meta` is atomic across concurrent per-slug PATCHes because the route is `async def` (runs on the single event loop, not a threadpool) and the merge body contains **no `await`** — cooperative scheduling means the RMW runs to completion before another coroutine can interleave. This deliberately uses **no `asyncio.Lock`** (redundant while the body stays await-free); the load-bearing rule is "never add an `await` inside `merge_overview_meta`". The write itself is a temp-file + atomic `os.replace`, so an external reader or a crash mid-write can never see a torn/truncated file. Two things this does **not** protect against: (1) running uvicorn with multiple worker processes — separate event loops would race, needing `flock` or atomic-rename-based cross-process coordination; (2) a torn read from an _external_ process still writing the file — that's why `read_overview_meta` swallows parse errors and degrades to `{}`, self-healing on the next refresh.
- **SSE lives here.** `/events` is a long-lived `text/event-stream` response; each subscriber gets its own `asyncio.Queue`. `/notify` fans an `event: notify` message out to every queue. Producers (today: the downloader, after a successful download) fire-and-forget — failure to deliver is silent and non-blocking, same contract as the previous Vite-plugin handler.
- **SSE streams are closed at signal time, not on lifespan shutdown.** The lifespan hook in `main.py` chains uvicorn's `SIGINT`/`SIGTERM` handlers: it calls `sse.close_all()` (pushes a `_SHUTDOWN` sentinel into every subscriber queue, ending each generator) and then delegates to the previous handler. It cannot be done in lifespan _shutdown_ — uvicorn waits for open connections to close **before** running lifespan shutdown, so an idle `/events` stream would deadlock that wait until force-quit and then be cancelled mid-response, printing an ASGI traceback on Ctrl-C. The delegation branch handles `SIG_DFL`/`SIG_IGN` by restoring and re-raising, so shutdown still happens if uvicorn isn't the signal owner.
- **CORS open to `http://localhost:5173`.** Backend and downloader call this service server-to-server, so no CORS entry is needed for them.
- **No auth.** Localhost-only trust model.

## Documentation

Every `def` / `async def` across database service `*.py` files has a one-line docstring as its first statement describing intent (not mechanics). A few carry an extra line when the WHY isn't obvious from the code — e.g. `_read_transcribe_partial` swallowing parse errors, `write_summary` snapshotting the pre-edit original on first write, `write_video` wiping derived artifacts, `broadcast_notify` being fire-and-forget.

**Maintain documentation on each change.** When adding a new function, give it a docstring in the same style. When changing a function's behavior, update its docstring.
