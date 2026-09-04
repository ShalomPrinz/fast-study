# CLAUDE.md — auto (auto-downloader)

## What this is

A Playwright HTTP service that, given a **course URL**, authenticates to Moodle's Web-Services API (a one-time headed token grab, then a long-lived stateless token — the Google-Drive-refresh-token model), discovers the course's recordings (and its PDF handouts) via that WS API, and resolves any of them into concrete download targets (`POST /resolve`) that `server/` then fetches and turns into jobs. A **separate package** with its own `node_modules` so Playwright and its browser binaries never leak into `server/`'s much lighter dependency set.

## Run

```bash
npm --prefix downloader/auto start   # HTTP service, app.js
npx playwright install chromium      # once, for the plain profile
npm --prefix downloader/auto test    # node --test, pure logic only (no browser, no network)
```

Port **3053** (`AUTODL_PORT`, from the repo-root `.env` via `src/lib/config.js`; `FASTSTUDY_PORT` in the environment wins), bound to `127.0.0.1` only. CORS allows the Vite origin `http://localhost:5173` and the packaged app's `app://bundle`. Zoom capture also needs `Xvfb` + system Google Chrome installed.

When `FASTSTUDY_SECRET` is set (the launcher sets it; unset means no enforcement), `requireSecret` from `@faststudy/runtime` (the shared launch-contract package at `lib/runtime/` in the repo root) rejects every request but `GET /health` that carries it neither as an `X-FastStudy-Secret` header nor as `?secret=`.

Everything this service writes — the Moodle token, the zoom passcode store, the yt-dlp cache — goes under the state root `@faststudy/runtime`'s `statePath` returns: `FASTSTUDY_STATE_DIR` when set, else `.state/` at the repo root. It only joins the path; each writer creates its own directory.

## HTTP surface

Mechanism-agnostic: `/list` and `/list/expand` return uniform `Item = { ref, title, kind, media, resolvedMedia?, expandable, section }` (`section` = the Moodle section heading, display metadata for grouping, `''` when unnamed; `media` = `'video'`|`'material'`|`'unknown'`, which file lands on disk — `video.mp4` vs a lecture material PDF — not how it is fetched, `'unknown'` for every `google-drive` and `direct-url` row since only the download-time probe can tell; `resolvedMedia` = `'video'`|`'material'`|`'unsupported'`, what a probed row turned out to be this session, absent when never probed); `/resolve` takes `{ ref, … }`. The download mechanism is hidden inside the opaque `ref` (base64url `Recording`). See `docs/BROWSING.md`.

| Endpoint              | Body                                                | Returns                                                                                 |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /health`         | —                                                   | `{ status:'ok' }` — liveness only, what the launcher waits on before opening the window |
| `GET /auth/status`    | —                                                   | `{ connected, expired }`                                                                |
| `POST /auth/connect`  | `{}`                                                | `{ status:'pending' }` (headed token grab opens)                                        |
| `POST /auth/complete` | —                                                   | `{ connected:true }` (persists the Moodle WS token)                                     |
| `POST /list`          | `{ courseUrl }`                                     | `{ items }`                                                                             |
| `POST /list/expand`   | `{ ref }`                                           | `{ items }` (resolve one expandable item → children)                                    |
| `POST /resolve`       | `{ ref, course, name, kind, only?, forceCapture? }` | `{ media, targets }`                                                                    |
| `POST /zoom/passcode` | `{ course, name?, passcode, scope }`                | `{}` (store a zoom passcode; `scope:'course'\|'lecture'`)                               |
| `POST /close`         | —                                                   | `{}` (close the persistent browser)                                                     |

`/resolve` returns the download targets, never a download: `targets` is
`[{ name, tool, url, headers?, fromCache }]`, one per file that will land (a zoom before/after-break
pair yields two, named `<base>.1`/`<base>.2`). `tool` is `'curl'`|`'fetch'`|`'ytdlp'` — the key of the
`server/` downloader that can fetch this cap; `headers` rides only with `curl`, the one tool that
replays them. `media` is what actually lands (`'video'`|`'material'`); it is the one field a Drive row
only learns here, from its download-time probe (`src/core/probeCache.js` memoizes the verdict for
the session, under the Drive file id or the normalized URL). auto keeps no job state and mints no job ids — `server/` creates a job per target and
owns the lifecycle from there (`server/docs/JOBS.md`).

**Session replay cache** (`src/core/replayCache.js`). Every resolved cap — `{url, headers}` (curl)
or `{url}` (yt-dlp) — is kept in memory keyed by its final `(course, lecture, kind, media)`
target (zoom split names included; `media` keeps a lecture's video and material caps
apart), so a retry replays it without re-capturing. In-memory only (dies
with the process), never logged (caps hold Cookies/tokens), unbounded (session-small). Two
optional `/resolve` flags drive it: `only:true` acts on just the one `(course, name, kind)`
target (`name` may be a zoom split `<base>.<n>`); `forceCapture:true` bypasses the cache and
captures fresh. Absent → the whole recording, cache-assisted. Every target
carries `fromCache:<bool>` so `server/` knows whether an auth failure is worth re-resolving —
only a replayed cap is (`server/docs/JOBS.md`). `only`+`forceCapture` re-sniffs the whole share (one zoom share yields
both clips), then returns only the cap whose split name matches the request.

`401 {status:'reconnect'}` = the Moodle WS token is missing or a call returned `invalidtoken`. `422 {status:'unsupported'}` = the source genuinely can't be handled: a `url` module target no download-time probe could turn into a file (the Drive probe resolves the real filename, the generic one reads the URL path then `Content-Disposition`/`Content-Type`, and both route video → yt-dlp, `.pdf` → material; anything else 422s naming what it turned out to be, and a Drive file that isn't shared "anyone with the link" yields no filename and 422s naming the sharing cause and the URL). Every unsupported verdict is memoized under its probe key, so they re-throw off the cache and stamp `resolvedMedia:'unsupported'` on `/list`; `forceCapture` re-probes. `409 {status:'passcode', reason, course, name}` = zoom passcode `missing` (none stored) or `incorrect` (stored one won't clear the gate); save one via `POST /zoom/passcode` and retry.

## Deep logic → `docs/`

- **`docs/SESSIONS.md`** — persistent per-profile browsers, `withLock` mutex, idle timeout, the launch matrix.
- **`docs/ZOOM.md`** — why zoom capture needs system Chrome + stealth + managed Xvfb; the UA/GPU constraints; passcode gate; before/after-break split.
- **`docs/BROWSING.md`** — the merged WS-contents + zoom-summary parsers, target-URL routing (every `url` module is listed; the recording keywords are only the `likelyRecording` hint), mimetype gating, the `Item`/`ref` contract, lazy playlist expansion. Strategies: `videostream` (in-site .mp4), `youtube-playlist`, `google-drive` (single Drive file, listed as `unknown` media, probed by filename at download → yt-dlp or material), `zoom`, `moodle-file` (course-hosted PDF → lecture material), `direct-url` (the catch-all `url` module, listed as `unknown` media, probed by URL path then headers at download).
- **`docs/AUTH.md`** — the Moodle WS token provider (`connect`/`complete`/`status`), `markExpired` → reconnect, on-demand autologin for videostream. Protocol details in **`docs/MOODLE.md`**.

Dev-stack wiring: the root `npm run dev` runs this as the `AutoDL` (cyan) `concurrently` process.
