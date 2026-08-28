# API — HTTP contract

Every other service reaches disk through these routes, so response shapes and paths are a
cross-service contract: keep changes backward-compatible or flag the impact.

## Conventions

- Mutations return a bare `204 No Content`, or `{error}` with a non-2xx status. The one exception
  is `POST /…/materials`, which answers `200 {name}` with the filename it allocated.
  Reads return their payload directly (`{summaries: [...]}`, `{files: [...]}`, the tree array).
- `?kind=lecture|recitation` addresses the two lecture families; it defaults to `lecture`.
- Bodies are raw bytes for file/video/summary writes, JSON for metadata routes.

## Routes

| Method+Path                                                        | Purpose                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `GET    /tree`                                                     | full course tree                                                           |
| `POST   /courses`                                                  | create course (`{name}`, optional `{source_url}`)                          |
| `PATCH  /courses/{course}`                                         | rename course (`{name}`)                                                   |
| `PATCH  /courses/{course}/source_url`                              | set/clear source_url; empty or null clears                                 |
| `PATCH  /courses/{course}/archived`                                | archive/unarchive (`{archived}`)                                           |
| `POST   /courses/{course}/lectures`                                | create lecture/recitation (`{name}`)                                       |
| `PATCH  /courses/{course}/lectures/{lecture}`                      | rename lecture/recitation (`{name}`)                                       |
| `PUT    /courses/{course}/lectures/{lecture}/video`                | upload `video.mp4`; wipes derived artifacts, auto-triggers the pipeline    |
| `GET    /courses/{course}/lectures/{lecture}/materials`            | `{materials: [...]}`, index-ordered; `[]` for an empty or missing lecture   |
| `POST   /courses/{course}/lectures/{lecture}/materials`            | add a material pdf; returns `{name}` with the allocated filename           |
| `PUT    /courses/{course}/lectures/{lecture}/files/{name}`         | write one file; neutral                                                    |
| `HEAD   /courses/{course}/lectures/{lecture}/files/{name}`         | 200 if present, else 404                                                   |
| `GET    /courses/{course}/lectures/{lecture}/files/{name}`         | stream one file                                                            |
| `DELETE /courses/{course}/lectures/{lecture}/files/{name}`         | delete one file                                                            |
| `GET    /courses/{course}/lectures/{lecture}/summary`              | `{content, hasOriginal}`                                                   |
| `PUT    /courses/{course}/lectures/{lecture}/summary`              | write `summary.md` (raw utf-8)                                             |
| `DELETE /courses/{course}/lectures/{lecture}/summary`              | revert to `original_summary.md`                                            |
| `GET    /courses/{course}/summaries`                               | every non-empty summary in a course; 404 if the course is missing          |
| `PUT    /courses/{course}/overview/files/{name}`                   | write a course-level file; 404 if the course is missing                    |
| `GET    /courses/{course}/overview/files`                          | list overview files                                                        |
| `GET    /courses/{course}/overview/files/{name}`                   | stream a course-level file                                                 |
| `GET    /courses/{course}/overview/meta`                           | `{meta}` (`{}` when absent)                                                |
| `PATCH  /courses/{course}/overview/meta`                           | merge one slug's entry (`{slug, entry}`)                                   |
| `GET    /settings`                                                 | the browser-dev settings store; API keys report set/unset only             |
| `PUT    /settings`                                                 | merge a partial settings object into the repo-root `.env`                  |
| `POST   /config`                                                   | apply `{data_root}` to the running process                                 |
| `GET    /events`                                                   | SSE stream of `notify` events                                              |
| `POST   /notify`                                                   | broadcast a `notify` event                                                 |

## Write semantics

The two file-write paths differ on purpose, and confusing them destroys data:

- **`PUT /…/video`** is the downloader's fresh-source path. It erases every predefined file plus
  every material pdf, the partial-transcript meta, and both pdf dotfiles — they all belong to
  the *old* video.
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

`DELETE /…/files/summary.pdf` additionally drops `.pdf_warning`. `crud.delete_file` is the single
chokepoint for that rule — a warning describes THIS pdf and cannot outlive it — so backend
teardown, frontend deletes, and re-render resets all get it without repeating the logic.

There is deliberately **no delete route for overview files**. Adding one must drop the pdf's
`.{slug}.pdf_warning` the same way.

## Summary editing

`PUT /…/summary` renames the existing `summary.md` to `original_summary.md` on the *first* edit
only, so the pipeline's untouched output stays recoverable however many times the user edits.
`hasOriginal` drives the revert affordance; `DELETE` restores and removes the original.

Summary writes never go through the generic files route — that would skip the snapshot.

## Video upload triggers the pipeline

After the bytes land, the video route fire-and-forgets a POST to
`${BACKEND_URL}/courses/{c}/lectures/{l}/pipeline?kind=…` so a downloader upload starts the
pipeline without a frontend click. It targets `/pipeline` rather than a single step so the run
continues past audio on its own; since the backend serializes per lecture, a later manual "Run
remaining" click reporting `busy` accurately describes a run already in flight rather than a lost
trigger. It runs on a worker thread with no timeout (a full run takes many minutes), and failures
are logged and swallowed — the upload already succeeded, and the user can always start the run
manually. The PUT responds as soon as the file is on disk.

Consequence: every upload, including every downloader upload, spends Groq and Gemini quota
unattended all the way to the finished summary.

## Settings

`settings.py` backs the app's settings surface in browser dev: the store is the repo-root `.env`,
resolved from the module's own location because each service runs with its own directory as cwd.
Under Electron the same fields live in `%APPDATA%`, so the two backings must agree on shape.

`GET /settings` answers with every field, `null` for any key absent from `.env` — the client applies
its own defaults, and an absent value has to stay distinguishable from a stored one:

| Field                                             | `.env` key                                        |
| ------------------------------------------------- | ------------------------------------------------- |
| `data_root`                                        | `DATA_ROOT`                                       |
| `gemini_api_key_set` / `groq_api_key_set` (bool)   | `GEMINI_API_KEY` / `GROQ_API_KEY`                 |
| `gemini_model`                                     | `GEMINI_MODEL`                                    |
| `drive_enabled`, `gdrive_root_folder`              | `DRIVE_ENABLED`, `GDRIVE_ROOT_FOLDER`             |
| `ui_language` (`he`\|`en`)                         | `UI_LANGUAGE`                                     |
| `auto_run_on_boot`, `runner_controls_visible`      | `AUTO_RUN_ON_BOOT`, `RUNNER_CONTROLS_VISIBLE`     |

The two API keys are **write-only**: `PUT` accepts `gemini_api_key` / `groq_api_key`, and the read
path reports only whether each is set, so a stored key never travels back to the client — the same
rule `safeStorage` follows under Electron. The three UI entries are frontend-owned; the store holds
them so a fresh browser profile and an Electron install agree on first-boot defaults.

`PUT /settings` takes a partial object of the same fields and answers with the `GET` shape. **It
merges, never rewrites**: only the named keys are touched, so ports, `DOWNLOADER_EXTENSION_ID`,
`FRONTEND_URL`, comments, blank lines, ordering and every unknown key survive. New keys append at
the end. An omitted field — and a `null`, so echoing a read back blanks nothing — is left alone; `""`
clears. Values are written single-quoted, which `.env` parsers read literally, so Windows
backslashes survive; a value containing a single quote or a line break is refused.

`DATA_ROOT` is validated before it is stored, by `PUT` and `POST /config` alike: it must be
absolute (a relative root would resolve against each service's own cwd), it is created if missing,
and a probe file is written and deleted to prove the location is writable — otherwise an unwritable
root surfaces as a pipeline failure minutes later.

`POST /config` applies `{data_root}` to `os.environ` and returns `204`. No restart is needed because
`fs/paths.py`'s `data_root()` re-reads the environment on every call; `main.py`'s module-level
`DATA_ROOT` is a boot-time fail-fast that nothing reads. Changing the root **re-points only and
never moves data**, so a change mid-run splits a lecture across two roots — the guard for that is
advisory and lives in the frontend, which knows what is in flight; there is deliberately no 409 here.

`logging_setup.py` (called once at `main.py` import, after uvicorn's own `dictConfig`, so it wins)
reformats uvicorn's access log to `[api] POST /courses/X/… → 200` and suppresses the routine
classes of line: every `HEAD`, every `OPTIONS`, and every `GET` that returned 2xx. Those requests
still run normally — they are the frontend's constant existence probes, CORS preflights, and
tree/status reads, and only their log lines are dropped. Failing GETs and all writes are always logged.

## Trust model

Localhost only, no auth. CORS allows `http://localhost:5173`; the backend and downloader call
server-to-server and need no entry. Overview routes validate their path segments (`_check_safe`
rejects separators and `..`); lecture routes rely on the localhost-only trust model instead.
