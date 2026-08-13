# CLAUDE.md — auto (auto-downloader)

## What this is

A Playwright HTTP service that, given a **course URL**, authenticates to Moodle's Web-Services API (a one-time headed token grab, then a long-lived stateless token — the Google-Drive-refresh-token model), discovers the course's recordings (and its PDF handouts) via that WS API, and downloads them — reusing `server/`'s `/download`, `/download-youtube` and `/download-file` for the actual fetch. A **separate package** with its own `node_modules` so Playwright and its browser binaries never leak into `server/`'s much lighter dependency set.

## Run

```bash
npm --prefix downloader/auto start   # HTTP service, app.js
npx playwright install chromium      # once, for the plain profile
npm --prefix downloader/auto test    # node --test, pure logic only (no browser, no network)
```

Port **3053** (`AUTODL_PORT`). Reads the repo-root `.env` (`src/lib/config.js`) for `SERVER_URL` (default `http://localhost:3052`) — the `server/` base it POSTs downloads to. CORS allows only the Vite origin `http://localhost:5173`. Zoom capture also needs `Xvfb` + system Google Chrome installed.

## HTTP surface

Mechanism-agnostic: `/list` and `/list/expand` return uniform `Item = { ref, title, kind, media, resolvedMedia?, expandable, section }` (`section` = the Moodle section heading, display metadata for grouping, `''` when unnamed; `media` = `'video'`|`'material'`|`'unknown'`, which file lands on disk — `video.mp4` vs a lecture material PDF — not how it is fetched, `'unknown'` for every `google-drive` row since only the download-time probe can tell; `resolvedMedia` = `'video'`|`'material'`|`'unsupported'`, what a Drive row was probed as this session, absent when never probed); `/download-item` takes `{ ref, … }`. The download mechanism is hidden inside the opaque `ref` (base64url `Recording`). See `docs/BROWSING.md`.

| Endpoint              | Body                                                | Returns                                                            |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /auth/status`    | —                                                   | `{ connected, expired }`                                           |
| `POST /auth/connect`  | `{}`                                                | `{ status:'pending' }` (headed token grab opens)                   |
| `POST /auth/complete` | —                                                   | `{ connected:true }` (persists the Moodle WS token)                |
| `POST /list`          | `{ courseUrl }`                                     | `{ items }`                                                        |
| `POST /list/expand`   | `{ ref }`                                           | `{ items }` (resolve one expandable item → children)               |
| `POST /download-item` | `{ ref, course, name, kind, only?, forceCapture? }` | `{ media }`                                                        |
| `POST /zoom/passcode` | `{ course, name?, passcode, scope }`                | `{ ok:true }` (store a zoom passcode; `scope:'course'\|'lecture'`) |
| `POST /close`         | —                                                   | `{ ok:true }` (close the persistent browser)                       |

`/download-item` returns 200 once the download is **queued**, not finished — any failure to queue
is an error status with a message (the zoom before/after-break pair spawns two jobs, but the count
isn't reported — the page follows the actual outcome on the job stream). `media` is what actually lands
(`'video'`|`'material'`); it is the one field a Drive row only learns here, from the download-time
filename probe (`src/core/driveProbeCache.js` memoizes it per Drive file id for the session).
auto keeps no job state and hands back no job ids — every spawned job is stamped with the row's `ref`, so the page re-finds them on `server/`'s own `GET /events` / `GET /jobs` by `ref`.
Job semantics, the change ping and the timing samples live in `server/docs/JOBS.md`.

**Session replay cache** (`src/core/replayCache.js`). Every resolved cap — `{url, headers}` (curl)
or `{url}` (yt-dlp) — is kept in memory keyed by its final `(course, lecture, kind, media)`
target (zoom split names included; `media` keeps a lecture's video and material caps
apart), so a retry replays it without re-capturing. In-memory only (dies
with the process), never logged (caps hold Cookies/tokens), unbounded (session-small). Two
optional `/download-item` flags drive it: `only:true` acts on just the one `(course, name, kind)`
target (`name` may be a zoom split `<base>.<n>`); `forceCapture:true` bypasses the cache and
captures fresh. Absent → today's behavior (whole recording, now cache-assisted). Each POST to
`server/` carries `fromCache:<bool>` so `server/` can silently re-capture a stale cached token
(`server/docs/JOBS.md`). `only`+`forceCapture` re-sniffs the whole share (one zoom share yields
both clips), then posts only the cap whose split name matches the request.

`401 {status:'reconnect'}` = the Moodle WS token is missing or a call returned `invalidtoken`. `422 {status:'unsupported'}` = the source genuinely can't be handled: a `url` module target that is neither a YouTube playlist nor a usable Google Drive file (a download-time probe resolves the Drive file's real filename and routes video → yt-dlp, `.pdf` → material; anything else 422s naming the actual extension, and a file that isn't shared "anyone with the link" yields no filename and 422s naming the sharing cause and the URL). Both unsupported verdicts are memoized per Drive file id, so they re-throw off the cache and stamp `resolvedMedia:'unsupported'` on `/list`; `forceCapture` re-probes. `409 {status:'passcode', reason, course, name}` = zoom passcode `missing` (none stored) or `incorrect` (stored one won't clear the gate); save one via `POST /zoom/passcode` and retry.

## Deep logic → `docs/`

- **`docs/SESSIONS.md`** — persistent per-profile browsers, `withLock` mutex, idle timeout, the launch matrix.
- **`docs/ZOOM.md`** — why zoom capture needs system Chrome + stealth + managed Xvfb; the UA/GPU constraints; passcode gate; before/after-break split.
- **`docs/BROWSING.md`** — the merged WS-contents + zoom-summary parsers, keyword/mimetype gating, the `Item`/`ref` contract, lazy playlist expansion. Strategies: `videostream` (in-site .mp4), `youtube-playlist`, `google-drive` (single Drive file, listed as `unknown` media, probed by filename at download → yt-dlp or material), `zoom`, `moodle-file` (course-hosted PDF → lecture material).
- **`docs/AUTH.md`** — the Moodle WS token provider (`connect`/`complete`/`status`), `markExpired` → reconnect, on-demand autologin for videostream. Protocol details in **`docs/MOODLE.md`**.

Dev-stack wiring: the root `npm run dev` runs this as the `AutoDL` (cyan) `concurrently` process.
