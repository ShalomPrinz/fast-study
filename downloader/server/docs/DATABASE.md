# Database contract (`src/services/database.js`)

All `DATABASE_URL` I/O (default `http://localhost:8001`) lives here. The server holds
no on-disk path conventions — the database service owns the `{course}/{lecture}/` and
`{course}/Recitations/{name}/` layout. `?kind=recitation` on the PUTs selects the
Recitations layout.

## `listCourses()` — GET `/tree` reshape

`/tree` returns rich lecture/recitation objects (`{name, files, materials, transcribePartial}`),
but the popup's autocomplete only wants names. We reshape to
`[{name, lectures:[...names], recitations:[...names]}]` here rather than change the
`/tree` contract the frontend depends on. Archived courses (`c.archived`) are dropped
so finished courses don't clutter the popup's suggestions.

## `uploadVideo` — video PUT wipes derived artifacts

Streams the temp `video.mp4` to
`PUT /courses/{course}/lectures/{lecture}/video?kind=`. This endpoint **also wipes any
derived `audio.mp3` / `transcript.txt` / `summary.*`** — correct for a fresh video.
`duplex: 'half'` is required by undici when the fetch body is a stream. The temp dir
is removed on success _or_ failure.

## `uploadPdf` / `uploadMaterial` — appending `/materials` POST does NOT wipe

Both POST raw PDF bytes to `/courses/{course}/lectures/{lecture}/materials?kind=` and get back
`{name}`. The **database allocates the filename** (`material.pdf`, then `material.2.pdf`, …)
atomically at write time, so a lecture holds many materials and a second upload appends instead of
overwriting; the server names nothing. Derived artifacts are left intact (unlike the video PUT),
since attaching material shouldn't invalidate an existing summary. The allocated `name` is what we log.

`uploadPdf(buf, …)` forwards bytes the extension already fetched: throws on a network error
(route → 500), returns `{ok:false}` on a database-level failure (route → 502).
`uploadMaterial(tempDir, …)` is the job path (`downloaders/fetch.js`): it streams the temp
PDF (`MATERIAL_TEMP_FILENAME`, a local temp name only), removes the temp dir either way, and
returns `{ok}` without throwing so the runner can turn it into the job's terminal state — same
shape as `uploadVideo`.

## `notifyFrontend` — SSE ping

The browser doesn't know when curl/yt-dlp finished, so after any successful upload we
fire a non-blocking `POST /notify`; the database's SSE bus tells connected sidebars to
refetch the tree. Failure is silent — a download still counts as done when the frontend
is down. (Uses `fetch`, keeping raw `node:http` confined to the size probe.)
