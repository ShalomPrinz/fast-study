# API — HTTP contract

Every other service reaches disk through these routes, so response shapes and paths are a
cross-service contract: keep changes backward-compatible or flag the impact.

## Conventions

- Mutations return a bare `204 No Content`, or `{error}` with a non-2xx status. Two answer with a
  body instead: `POST /…/materials` returns `200 {name}` with the filename it allocated, and
  `PUT /settings` returns `200` with the stored view.
  Reads return their payload directly (`{summaries: [...]}`, `{files: [...]}`, the tree array).
- `?kind=lecture|recitation` addresses the two lecture families; it defaults to `lecture`.
- Bodies are raw bytes for file/video/summary writes, JSON for metadata routes.
- Every route that touches `DATA_ROOT` answers `409` `{error}` while no data root is configured;
  the exceptions are the three settings routes, since the first-run wall depends on them, and
  `/health`, which the launcher polls before either exists. See [SETTINGS.md](SETTINGS.md).
- `423` `{error}` means another program holds the file open — a write or delete refused by a
  Windows sharing violation. Only the two `/…/files/{name}` routes raise it; see Write semantics.

## Routes

| Method+Path                                                | Purpose                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET    /health`                                           | launcher liveness; `200 {status: ok}` even with no data root configured   |
| `GET    /tree`                                             | full course tree                                                          |
| `POST   /courses`                                          | create course (`{name}`, optional `{source_url}`)                         |
| `PATCH  /courses/{course}`                                 | rename course (`{name}`)                                                  |
| `PATCH  /courses/{course}/source_url`                      | set/clear source_url; empty or null clears                                |
| `PATCH  /courses/{course}/archived`                        | archive/unarchive (`{archived}`)                                          |
| `POST   /courses/{course}/lectures`                        | create lecture/recitation (`{name}`)                                      |
| `PATCH  /courses/{course}/lectures/{lecture}`              | rename lecture/recitation (`{name}`)                                      |
| `PUT    /courses/{course}/lectures/{lecture}/video`        | upload `video.mp4`; wipes derived artifacts                               |
| `GET    /courses/{course}/lectures/{lecture}/materials`    | `{materials: [...]}`, index-ordered; `[]` for an empty or missing lecture |
| `POST   /courses/{course}/lectures/{lecture}/materials`    | add a material pdf; returns `{name}` with the allocated filename          |
| `PUT    /courses/{course}/lectures/{lecture}/files/{name}` | write one file; neutral; `423` if it is open in another program           |
| `HEAD   /courses/{course}/lectures/{lecture}/files/{name}` | 200 if present, else 404                                                  |
| `GET    /courses/{course}/lectures/{lecture}/files/{name}` | stream one file                                                           |
| `GET    /courses/{course}/lectures/{lecture}/files/{name}/path` | `{path}`, the absolute on-disk path; 404 if absent                   |
| `DELETE /courses/{course}/lectures/{lecture}/files/{name}` | delete one file; `423` if it is open in another program                   |
| `GET    /courses/{course}/lectures/{lecture}/summary`      | `{content, hasOriginal}`                                                  |
| `PUT    /courses/{course}/lectures/{lecture}/summary`      | write `summary.md` (raw utf-8)                                            |
| `DELETE /courses/{course}/lectures/{lecture}/summary`      | revert to `original_summary.md`                                           |
| `GET    /courses/{course}/summaries`                       | every non-empty summary in a course; 404 if the course is missing         |
| `PUT    /courses/{course}/overview/files/{name}`           | write a course-level file; 404 if the course is missing; `423` if it is open in another program |
| `GET    /courses/{course}/overview/files`                  | list overview files                                                       |
| `GET    /courses/{course}/overview/files/{name}`           | stream a course-level file                                                |
| `GET    /courses/{course}/overview/files/{name}/path`      | `{path}`, the absolute on-disk path; 404 if absent                        |
| `GET    /courses/{course}/overview/meta`                   | `{meta}` (`{}` when absent)                                               |
| `PATCH  /courses/{course}/overview/meta`                   | merge one slug's entry (`{slug, entry}`)                                  |
| `GET    /settings`                                         | the browser-dev settings store; API keys report set/unset only            |
| `PUT    /settings`                                         | merge a partial settings object into the repo-root `.env`                 |
| `POST   /config`                                           | apply `{data_root}` to the running process                                |
| `GET    /events`                                           | SSE stream of `notify` events                                             |
| `POST   /notify`                                           | broadcast a `notify` event                                                |

## Write semantics

The two file-write paths differ on purpose, and confusing them destroys data:

- **`PUT /…/video`** is the downloader's fresh-source path. It erases every predefined file plus
  every material pdf, the partial-transcript meta, and both pdf dotfiles — they all belong to
  the _old_ video.
  It creates the lecture dir on demand — the downloader uploads to brand-new lectures.
- **`POST /…/materials`** appends an attached PDF, allocating its name server-side (see
  LAYOUT.md) and returning it. Also creates the lecture dir on demand. Callers that already know
  the exact filename keep using `PUT /…/files/{name}`; delete/get/head go through the files
  routes unchanged. `GET /…/materials` returns the same entries the tree inlines, so a caller
  needing one lecture's materials doesn't pull the whole tree; a missing lecture yields `[]`
  rather than 404, matching how the tree degrades.
- **`PUT /…/files/{name}`** is the backend pipeline's path (`audio.mp3`, `transcript.txt`,
  `summary.pdf`, `drive_url.txt`, …). It is strictly neutral; wiping here would erase earlier
  outputs of the run in progress.

Both `PUT` and `DELETE /…/files/{name}` answer `423 Locked` when Windows refuses the operation
because another process holds the file open (`ERROR_SHARING_VIOLATION` 32 / `ERROR_LOCK_VIOLATION`
33) — a native PDF viewer left open on `summary.pdf` is the everyday cause, since the app opens
PDFs in the user's own registered app. The `{error}` text names the file and the fix, and the
backend passes it straight through into the pipeline step error. A `PermissionError` without one of
those two codes stays a `400`: POSIX has no mandatory locking, so there it is a genuine permissions
problem and mislabelling it would send the user chasing the wrong thing.

`DELETE /…/files/summary.pdf` additionally drops `.pdf_warning`. `crud.delete_file` is the single
chokepoint for that rule — a warning describes THIS pdf and cannot outlive it — so backend
teardown, frontend deletes, and re-render resets all get it without repeating the logic.

There is deliberately **no delete route for overview files**. Adding one must drop the pdf's
`.{slug}.pdf_warning` the same way.

The two `GET /…/files/{name}/path` routes hand back the absolute on-disk path instead of bytes, so
the Electron launcher can `shell.openPath` a file in the user's own registered app without
re-deriving the layout this service owns. The name is validated first — `shell.openPath` _launches_
what it is given, so an unchecked `..\` or `C:\…` would be an open-any-file primitive.

## Summary editing

`PUT /…/summary` renames the existing `summary.md` to `original_summary.md` on the _first_ edit
only, so the pipeline's untouched output stays recoverable however many times the user edits.
`hasOriginal` drives the revert affordance; `DELETE` restores and removes the original.

Summary writes never go through the generic files route — that would skip the snapshot.

## No outbound calls

This service never calls another service; it only answers requests and fans out SSE on `/events`.
Whoever uploads a video reports the arrival to the backend itself — "a video arrived, so run the
pipeline" is backend policy (`AUTO_RUN`), and the store has no stake in it. Keeping the store
call-free is also what stops a `backend ↔ database` dependency cycle.

## Settings

The settings store is the repo-root `.env` rather than anything under `DATA_ROOT`; its fields,
merge semantics and `DATA_ROOT` validation live in [SETTINGS.md](SETTINGS.md).

| Route           | Answers                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /settings` | `200` with every field, `null` when unset; `500` `{error}` if the store is unreadable                 |
| `PUT /settings` | `200` with the same shape; `400` `{error}` on a rejected value                                        |
| `POST /config`  | `204`, clearing the unconfigured state; `400` `{error}` on a data root that is relative or unwritable |

`PUT /settings` is the second exception to the 204-on-mutation convention: it answers with the
`GET` shape so the client never needs a follow-up read.

Values are typed three ways — string, bool (`drive_enabled`, `nightly_run`) and int
(`nightly_hour`) — and the type is the whole of the validation: a wrong type is `400`, but a value's
meaning, like whether an hour is in `0..23`, is the owning service's to enforce. `PUT` rejects a
boolean for an int field on purpose, since Python would otherwise store `true` as `1`.

## Access logging

`setup_logging()` from the shared [`lib/logging`](../../lib/logging/CLAUDE.md), called once at
`database_main.py` import, owns the `uvicorn.access` logger outright: at that point uvicorn has
configured nothing, so it installs its own `StreamHandler` and sets `propagate = False` rather than
re-formatting a handler uvicorn placed. `runtime.serve()` then starts uvicorn with `log_config=None`
so uvicorn's own `dictConfig` never runs and never replaces it — the two go together. The access log
therefore goes to stderr, off stdout, which is the `FASTSTUDY_PORT=<n>` port-handshake channel
uvicorn's default access handler would otherwise share. Lines come out as
`[api] POST /courses/X/… → 200`, and the routine classes are suppressed: every `HEAD`, every
`OPTIONS`, and every `GET` that returned 2xx. Those requests still run normally — they are the
frontend's constant existence probes, CORS preflights, and tree/status reads, and only their log
lines are dropped. Failing GETs and all writes are always logged.

## Trust model

Localhost only. When `FASTSTUDY_SECRET` is set, `runtime.install_secret_check` requires it on every
request — the `X-FastStudy-Secret` header **or** a `secret` query parameter, the latter because native
`EventSource` cannot set a header. `GET /health` is the only exemption, so the launcher can tell a
wrong secret from a dead child. Rejections are `401 {"error": "unauthorized"}`, except a request whose
`Accept` contains `text/event-stream`, answered `401` with an empty `text/event-stream` body — any
other MIME makes `EventSource` report a bare transport error instead of the auth failure. Binding to
loopback is not itself a defence: the secret is what keeps another local process or page off the API.
An unset `FASTSTUDY_SECRET` installs no middleware at all, which is what dev runs on.

CORS allows `http://localhost:5173` (browser dev) and `app://bundle`, the packaged frontend's
origin, matched verbatim because browsers send it with no trailing slash; the backend and
downloader call server-to-server and need no entry. The secret check is installed _before_
`CORSMiddleware` so CORS stays outermost and a `401` carries CORS headers; Starlette short-circuits
preflights, so `OPTIONS` never reaches the check.

Both file-path resolvers — `fs/files.file_path` and `fs/overview.overview_file_path` — validate the
caller's file name through `check_safe_segment` (`fs/paths.py`: no separator, `..`, or NUL),
answering `400`; that is the path the `/path` routes hand to `shell.openPath`. Course and lecture
names need no separate guard, since the resolvers run them through `safe_name()`. The write and
delete routes rely on the localhost-only trust model instead.
