# Database contract (`src/services/database.js`)

All `DATABASE_URL` I/O lives here. The server holds no on-disk path conventions — the database owns
the `{course}/{lecture}/` and `{course}/Recitations/{name}/` layout, and `?kind=recitation` selects
the latter.

## `listCourses()` — `/tree` reshape

`/tree` returns rich lecture objects, but the popup's autocomplete wants names only, so they are
reshaped here to `[{name, lectures, recitations}]` rather than changing a `/tree` contract the
frontend depends on. Archived courses are dropped so finished ones don't clutter suggestions.

## `uploadVideo` — the video PUT wipes derived artifacts

Streams the temp `video.mp4` to `PUT /courses/{course}/lectures/{lecture}/video?kind=`, which **also
wipes any derived `audio.mp3` / `transcript.txt` / `summary.*`** — correct for a fresh video.
`duplex: 'half'` is required by undici for a stream body.

## `uploadMaterial` / `uploadPdf` — the `/materials` POST appends and wipes nothing

Both POST PDF bytes to `/courses/{course}/lectures/{lecture}/materials?kind=` and get back `{name}`.
The **database allocates the filename** (`material.pdf`, `material.2.pdf`, …) atomically, so a second
upload appends instead of overwriting and the server names nothing. Derived artifacts survive:
attaching material shouldn't invalidate an existing summary.

`uploadVideo` and `uploadMaterial` are the job path: they stream from the temp dir, remove it either
way, and never throw — `null` on success, else the error message the runner turns into the job's
terminal state. `uploadPdf` forwards bytes the extension already fetched: it throws on a network error
(route → 500) and returns the message on a database-level failure (route → 502).

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
