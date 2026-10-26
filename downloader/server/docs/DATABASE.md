# Database contract (`src/services/database.js`)

All `DATABASE_URL` I/O lives here. The server holds no on-disk path conventions — the database owns
the `{course}/{lecture}/` and `{course}/Recitations/{name}/` layout, and `?kind=recitation` selects
the latter.

## `listCourses()` — `/tree` reshape

`/tree` returns rich lecture objects, but the popup's autocomplete wants names only, so they are
reshaped here to `[{name, lectures_only, lectures, recitations}]` rather than changing a `/tree`
contract the frontend depends on. Archived courses are dropped so finished ones don't clutter
suggestions. `lectures_only` is the database's per-course resolution, passed through so the popup
hides the Lecture/Recitation choice; `getCourseStructure()` proxies `GET /course_structure` (the
live global mode) for a course typed in that the tree doesn't hold yet.

## `ensureCourse()` — the extension may name a new course

The database's video PUT and `/materials` POST answer 404 `course_not_found` for a missing course,
and its `POST /courses` refuses an existing one (409 `name_taken`). So `/download`,
`/download-youtube` and `/upload-pdf` — the extension's routes, whose course field is free text —
first `POST /courses` unconditionally, so no download pays for a full `/tree` scan. A 409
`name_taken` means the folder exists (archived, a race, or a case-only match on Windows) and counts
as success. Any other refusal is answered as a 502 with the database's own `code`, and no job starts.

## `uploadVideo` — the video PUT wipes derived artifacts

Streams the temp `video.mp4` to `PUT /courses/{course}/lectures/{lecture}/video?kind=`, which **also
wipes any derived `audio.mp3` / `transcript.txt` / `summary.*`** — correct for a fresh video.
`duplex: 'half'` is required by undici for a stream body.

## `uploadMaterial` / `uploadPdf` — the `/materials` POST appends and wipes nothing

Both POST bytes to `/courses/{course}/lectures/{lecture}/materials?kind=` and get back `{name}`.
The **database allocates the filename** (`material.pdf`, `material.2.pdf`, …) atomically, so a second
upload appends instead of overwriting and the server names nothing. Derived artifacts survive:
attaching material shouldn't invalidate an existing summary.

`uploadMaterial` sends `application/octet-stream` (the database ignores the type) and, when the
resolved target carried one, `&filename=<original name>`, from which the database picks the disk
extension. `uploadPdf` (the extension, PDF-only) sends none, so it lands as `.pdf`.

A material downloaded from a discovery row — `/download-item` or a section run — also sends
`&source=<ref>`: the row's `ref`, verbatim as `/list` gave it, which the database stores as the
material's identity so the frontend can tell this row's file from another one in the same lecture
(`startJob`'s `ref` → the runner's `source` → `uploadMaterial`). Every other path
(`/download-url`, `/upload-pdf`) sends none, and a video upload never carries one. The match holds
only because `auto/`'s ref is a pure function of the WS listing ([BROWSING.md](../../auto/docs/BROWSING.md#the-item--ref-contract)).

## `uploadAssignmentFile` — a `media: 'assignment'` target

A target whose `/resolve` answered `media: 'assignment'` is fetched like a material (`material.bin`) and
POSTed to `/courses/{course}/assignments/{name}/files?filename=&source=` (all URL-encoded), where `name`
is the submission's destination name (the job's `lecture`), `filename` the target's original name and
`source` the row's `ref`. It makes no backend call (no `/video-arrived`, no auto-run); the `/timing`
sample is recorded as for any fetch. The database's `{assignment, name}` answer is only logged: `renames`
carries the stored spelling of the submitted `name`, as for every submission.

`uploadVideo`, `uploadMaterial` and `uploadAssignmentFile` are the job path: they stream from the temp dir, remove it either
way, and never throw — `null` on success, else the failure body the runner turns into the job's
terminal state. `uploadPdf` forwards bytes the extension already fetched: it throws on a network error
(route → 500) and returns the failure body on a database-level failure (route → 502).

A database refusal that carries a `code` is forwarded with its `code`/`params`/`error` unchanged
(`name_reserved`, `file_locked`, …); only a codeless one — a network error, a non-JSON body — becomes
`database_store_failed` with `detail`.

## After a successful upload

- **`notifyFrontend`** — a non-blocking `POST /notify`, so the database's SSE bus tells connected
  sidebars to refetch the tree (the browser can't know when curl/yt-dlp finished). Silent on failure:
  a download still counts as done when the frontend is down.
- **`reportVideoArrived`** (`services/backend.js`) — after a video PUT only, fire
  `POST {BACKEND_URL}/courses/{course}/lectures/{lecture}/video-arrived?kind=`; the backend alone
  decides from `AUTO_RUN` whether that starts a pipeline run. Whoever stores a video announces it,
  because the database is a store that makes no outbound calls. Fire-and-forget and silent for the
  same reason: the bytes are stored, so a dead backend must not fail a finished job. A material POST
  starts nothing.
