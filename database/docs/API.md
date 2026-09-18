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
  Windows sharing violation. Every route that writes or deletes a file raises it; see Write semantics.
- `400` `{error}` covers a `{name}` that could escape its directory, on every file route; see the
  trust model.

## Routes

| Method+Path                                                | Purpose                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET    /health`                                           | launcher liveness; `200 {status: ok}` even with no data root configured   |
| `GET    /tree`                                             | full course tree; `video.mp4` entries carry `duration` (seconds; omitted when unknown) |
| `POST   /courses`                                          | create course (`{name}`, optional `{source_url}`)                         |
| `PATCH  /courses/{course}`                                 | rename course (`{name}`)                                                  |
| `PATCH  /courses/{course}/source_url`                      | set/clear source_url; empty or null clears                                |
| `PATCH  /courses/{course}/archived`                        | archive/unarchive (`{archived}`)                                          |
| `POST   /courses/{course}/lectures`                        | create lecture/recitation (`{name}`)                                      |
| `PATCH  /courses/{course}/lectures/{lecture}`              | rename lecture/recitation (`{name}`)                                      |
| `PUT    /courses/{course}/lectures/{lecture}/video`        | upload `video.mp4`; wipes derived artifacts; `423` if one is open elsewhere |
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
  the _old_ video. The wipe is all-or-nothing: the whole set is probed for locks first, so one
  file open in a viewer answers `423` with the lecture untouched rather than half-wiped.
  It creates the lecture dir on demand — the downloader uploads to brand-new lectures.
- **`POST /…/materials`** appends an attached PDF, allocating its name server-side (see
  [LAYOUT.md](LAYOUT.md#materials)) and returning it. Also creates the lecture dir on demand. Callers that already know
  the exact filename keep using `PUT /…/files/{name}`; delete/get/head go through the files
  routes unchanged. `GET /…/materials` returns the same entries the tree inlines, so a caller
  needing one lecture's materials doesn't pull the whole tree; a missing lecture yields `[]`
  rather than 404, matching how the tree degrades.
- **`PUT /…/files/{name}`** is the backend pipeline's path (`audio.mp3`, `transcript.txt`,
  `summary.pdf`, `drive_url.txt`, …). It is strictly neutral; wiping here would erase earlier
  outputs of the run in progress.

Every route that writes or deletes a file answers `423 Locked` when Windows refuses the operation
because another process holds the file open — a native PDF viewer left open on `summary.pdf` is the
everyday cause, since the app opens PDFs in the user's own registered app. The `{error}` text names
the file and the fix, and the backend passes it straight through into the pipeline step error.

Detecting it takes two checks, because the two ways to reach the filesystem report a lock
differently. `os.unlink`/`os.replace` go through Win32 and carry `winerror`
(`ERROR_SHARING_VIOLATION` 32 / `ERROR_LOCK_VIOLATION` 33). `open()`/`write_bytes()` go through the
CRT, which sets `errno=EACCES` and leaves `winerror` unset — indistinguishable from a real denial
until the alternatives are excluded, so on Windows an `EACCES` naming an existing, writable regular
file counts as a lock too. Everything else stays a `400`: POSIX has no mandatory locking, and a
read-only file or a directory is a genuine permissions problem that mislabelling would send the
user chasing the wrong thing.

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

This service calls nobody (root `CLAUDE.md`). Whoever uploads a video reports it to the backend
itself: "a video arrived, so run the pipeline" is backend policy (`AUTO_RUN`), not the store's.

## Settings

The settings store is the repo-root `.env` rather than anything under `DATA_ROOT`; its fields,
merge semantics and `DATA_ROOT` validation live in [SETTINGS.md](SETTINGS.md).

| Route           | Answers                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /settings` | `200` with every field, `null` when unset; `500` `{error}` if the store is unreadable                 |
| `PUT /settings` | `200` with the same shape; `400` `{error}` on a rejected value                                        |
| `POST /config`  | `204`, clearing the unconfigured state; `400` `{error}` on a data root that is relative or unwritable |

## Access logging

[`lib/logging`](../../lib/logging/CLAUDE.md)'s `setup_logging()`, called at `database_main.py`
import. The lines it drops — every `HEAD`, `OPTIONS` and 2xx `GET` — are here the frontend's
existence probes, CORS preflights and tree reads; failing GETs and every write are logged.

## Trust model

Localhost only, and loopback is not itself a defence: when `FASTSTUDY_SECRET` is set, the launch
secret is what keeps another local process or page off the API. The check and its rules — header or
`?secret=`, the `/health` exemption, the `401` shapes — are
[`lib/runtime`](../../lib/runtime/CLAUDE.md)'s `install_secret_check`, installed before
`CORSMiddleware` so a `401` carries CORS headers.

CORS allows `http://localhost:5173` (browser dev) and `app://bundle` (the packaged frontend, matched
verbatim — root `CLAUDE.md`); the backend and downloader call server-to-server and need no entry.

Every caller-supplied file name goes through `check_safe_segment` before it is joined onto a
resolved directory, on every resolver and mutator, answering `400`. It matters most on the `/path`
routes, whose answer the launcher hands to `shell.openPath`, but a write or delete is the same
primitive. Course and lecture names need no separate guard: `safe_name()` drops separators.
