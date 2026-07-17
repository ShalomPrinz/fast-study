# CLAUDE.md — downloader

## What this is

A Chrome extension (Manifest V3) plus a tiny local Node server that together capture video streams from web pages and hand them off to the database service, which writes `{DATA_ROOT}/{course}/{lecture}/video.mp4` so the backend's `/run/audio` step can pick them up with no manual file moves. Two source paths:

## Layout

```
extension/regular/   Chrome MV3 extension: background.js, manifest.json, popup.html, popup.js
extension/simple/    Simplified extension-only variant (no server; saves to Downloads/)
server/              server.js (the npm-start server) + package.json
auto/                Auto-downloader: Playwright HTTP service (talks to server/ over HTTP)
```


- **Generic `.mp4` capture** — sniff the browser's network requests, replay the captured headers via `curl`. This is the only thing that works for streaming sites that gate `.mp4` URLs behind short-lived tokens + Referer/Origin checks.
- **YouTube** — captured `.mp4` URLs are useless because YouTube uses DASH-segmented streams; shell out to `yt-dlp` instead, which handles signed URLs and audio/video muxing.
- **PDF** — when the active tab is a `.pdf`, the popup fetches it directly (with the user's cookies) and uploads it as `material.pdf`; no header replay needed since PDFs aren't token-gated.

## Running

```bash
npm --prefix downloader/server start   # starts server/server.js on port 3052 (no deps; Node stdlib only)
npm --prefix downloader/auto start     # starts auto/src/server.js on port 3053 (the HTTP service; needs Playwright)
```

The Chrome extension is loaded unpacked from `downloader/extension/regular` (the simple variant from `downloader/extension/simple`). `server/server.js` only accepts requests from one hardcoded extension ID (`EXTENSION_ID`); if you reload the extension and Chrome assigns a new ID, update that constant in `server/server.js` or CORS will block the popup.

`server/server.js` reads the repo-root `.env` (`path.resolve(__dirname, '..', '..', '.env')`, no `dotenv` dep — tiny inline parser) to pick up `DATABASE_URL` (default `http://localhost:8001`). It no longer touches `DATA_ROOT` itself — all filesystem I/O goes through the database service.

## Architecture

Four pieces, one flow:

1. **`background.js`** (extension service worker) — listens to `webRequest.onSendHeaders` on `<all_urls>`, captures any request whose URL path ends in `.mp4`, resolves the originating tab's URL via `chrome.tabs.get(details.tabId)`, and stashes `{url, headers, capturedAt, pageUrl}` in `chrome.storage.local`. Captures without a resolvable `pageUrl` are dropped. The store is a deduped ring of up to 50 entries (across all tabs); the toolbar badge count is set **per tab** (`setBadgeText({ tabId, text })`) and reflects only that page's captures.

2. **`popup.html` + `popup.js`** — on open:
   - `GET /courses` populates course/lecture autocomplete and pre-fills the lecture name via `suggestLectureName` (mirrors `frontend/src/components/Sidebar.tsx`).
   - Hostname-checks `activeTab.url` against `{youtube.com, www.youtube.com, m.youtube.com, youtu.be}`.
     - **YouTube path:** hides the captured-requests `<select>`, shows the page URL as a readonly field, POSTs `{url, course, lecture, kind}` to `/download-youtube`.
     - **Generic path:** reads `videoRequests` from storage and **filters by exact-match `pageUrl === activeTab.url`** so captures from other pages/tabs never leak in. Renders each capture in a `<select>` prefixed with its size (`[412.3 MB] host … file.mp4`). Sizes are probed lazily via `POST /probe-size` (the server uses Node `http`, which can send the captured `Cookie` header that `fetch` forbids); the probe does HEAD then falls back to a `Range: bytes=0-0` GET reading `Content-Range`. Failures render `[?]`; pending probes show `[…]`. On submit, POSTs `{url, headers, course, lecture, kind}` (raw URL + captured headers — not a prebuilt curl string) to `/download`.
   - **PDF path:** if `activeTab.url` ends in `.pdf`, shows the URL readonly; on submit the popup `fetch`es the PDF itself (`credentials: 'include'`, so the user's session cookies authenticate) and POSTs the bytes to `/upload-pdf?course=&lecture=&kind=`. Only one of {video, PDF, empty} is shown — video wins; PDF mode pre-fills the *latest* existing lecture name (attach material), not the next one.

3. **`server.js`** — five endpoints, all I/O routed through the database service (`DATABASE_URL`, default `localhost:8001`):
   - `GET /courses` → fetches `${DATABASE_URL}/tree`, drops archived courses (`c.archived`), then reshapes to `[{name, lectures, recitations}]` where `lectures`/`recitations` are plain name arrays. `/tree` returns rich lecture objects (`{name, files, transcribePartial}`); popup.js only needs the names, so the reshape happens here rather than in the database service contract (which the frontend depends on). Archived courses are filtered out so finished courses don't clutter the popup's suggestions.
   - `POST /probe-size` → runs `probeContentLength` (Node `http`, HEAD → ranged-GET fallback) on `{url, headers}` and returns `{bytes}`; the popup calls this because `fetch` strips the `Cookie` header the probe needs.
   - `POST /download` → validates inputs (`isSafeName` rejects `/`, `\`, `.`, `..`), `mkdtemp`s a private temp dir under the OS temp root, builds curl args from the captured headers (stripping `Range`, `If-Range`, `If-None-Match`, `If-Modified-Since`, `Host`, `Content-Length` — see `SKIP_HEADERS`), forces `--output video.mp4`, and `spawn`s curl (no shell, `--silent --show-error`, stdio `ignore/ignore/pipe`) with `cwd` set to the temp dir. `--retry 3 --retry-all-errors` covers flaky CDNs that close TLS without `close_notify` mid-stream. On `child.on('close', code === 0)`, the temp `video.mp4` is streamed via `PUT ${DATABASE_URL}/courses/{course}/lectures/{lecture}/video?kind=...` (which also wipes any derived `audio.mp3`/`transcript.txt`/`summary.*` — correct for a fresh video). Temp dir is removed on success or failure.
   - `POST /download-youtube` → same input validation + temp dir, but `spawn`s `yt-dlp` with `-o video.%(ext)s --merge-output-format mp4 --no-playlist --js-runtimes node --remote-components ejs:github --quiet --no-warnings --no-progress` (stdio `ignore/ignore/pipe`). No captured headers — yt-dlp manages its own session. Recent yt-dlp needs a JS runtime for YouTube's player script; we point it at the `node` we already have. Same temp-dir → database PUT flow as `/download`.
   - `POST /upload-pdf?course=&lecture=&kind=` → receives raw PDF bytes the popup already fetched, then PUTs them to `${DATABASE_URL}/courses/{course}/lectures/{lecture}/files/material.pdf?kind=...` — the neutral `/files/` endpoint, which does *not* wipe derived `audio.mp3`/`transcript.txt`/`summary.*` (unlike the video PUT, since adding material shouldn't invalidate an existing summary). `MATERIAL_FILENAME` = `material.pdf`.
   - (On successful upload from any path) `notifyFrontend()` fires a non-blocking `POST ${DATABASE_URL}/notify` so the database's SSE bus tells all connected sidebars to re-fetch the tree. Failure (HTTP 4xx/5xx, `{ok: false}`, or network error) is logged to the server console — same surface as today's curl/mkdir failures — and `notifyFrontend()` is skipped.

4. **Size probes + progress rendering** — `probeContentLength` (curl path, HEAD → ranged-GET fallback) and `probeYoutubeSize` (yt-dlp `--skip-download --print %(filesize,filesize_approx)s` summed across the `bv*+ba/b` format selection) print an expected size before each download. The children then run **silent** (curl `--silent`, yt-dlp `--no-progress`); the server is the *sole* terminal writer. It registers each in-flight download in a module-level `Map` and a single shared `setInterval` (~1.5s, started on the first register, cleared when the registry empties) polls the temp size against the probed total — curl: `stat video.mp4`; yt-dlp: **sum all temp files** (separate audio/video before merge), clamped ≤99% until exit. **WHY not just inherit the children's progress bars:** two parallel `--progress-bar`/`--progress` children share one terminal line, and their `\r` repaints stomp each other (and our `console.log`s). **WHY two render paths:** under `concurrently` (`npm run dev`) the server's stdout is a *pipe, not a TTY* (lines prefixed `Downloader |`), so ANSI cursor repaint is meaningless — the non-TTY path emits throttled newline-terminated lines (only when percent advanced ≥5% or several seconds elapsed), which can't interleave mid-line. The TTY path (`npm start`) repaints a compact block in place via ANSI. Lines look like `📥 [{course}/{lecture}] 52% (210/402 MB)`; unknown probe shows a byte count + "downloading…". Child stderr is captured to a tail buffer (we no longer inherit it) so a non-zero exit still logs the real error.

Recitations are routed via the database PUT endpoint's `?kind=recitation` query — the database service owns the on-disk layout (`{course}/Recitations/{name}/`).

## Auto-downloader HTTP service (`auto/`, port 3053)

`auto/` is a **separate package** (its own `node_modules`) so Playwright never leaks into the dependency-free `server/`. Given a course URL it authenticates (persisted Microsoft login), discovers the recordings, and downloads them by reusing `server/`'s `/download` + `/download-youtube`. It is documented in its own **`auto/CLAUDE.md`** (what it is, how to run it, the mechanism-agnostic HTTP surface + endpoint table) with the deep logic in **`auto/docs/`** (`SESSIONS.md`, `ZOOM.md`, `BROWSING.md`, `AUTH.md`). Don't restate that here.

## Why these specific hacks

- **Header replay (`buildCurlArgs`).** Streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin checks. Cloning the browser's exact headers reuses the live session — naive downloading 403s.
- **`SKIP_HEADERS` strips conditional/range headers.** If the original captured request was a ranged segment fetch, replaying `Range:` makes curl save a partial body that lacks the MP4 header at offset 0 and is unplayable.
- **yt-dlp for YouTube.** DASH-segmented streams (separate audio/video tracks behind signed URLs) means the `.mp4`-capture flow gets nothing usable. `yt-dlp` resolves the manifest, downloads both tracks, and muxes to `video.mp4`. **Prerequisite:** `yt-dlp` must be installed system-wide (`pipx install yt-dlp` or `apt install yt-dlp`) — same kind of external-CLI dependency as `ffmpeg` is for the backend. The server doesn't install it.
- **Per-tab badge / per-page filter.** Multiple lectures open in different tabs would otherwise pollute each other's capture list.
- **SSE notify ping.** The browser doesn't know when curl/yt-dlp finished, so the server actively tells the frontend after `child.on('close', code === 0)`.

## Conventions

- ESM only (`"type": "module"` in `package.json`); use `import`, not `require`.
- The Node servers (`server/` and `auto/`) may use npm packages freely; **only the Chrome extension** (`extension/`) must avoid them (MV3 constraint). `auto/` uses Express + cors + dotenv; `server/server.js` currently happens to be stdlib-only, but that's a local choice, not a rule.
- Use `execFile` / `spawn` with argv arrays, never `exec` (shell string), so header values containing shell metacharacters can't inject.
- Saved video is **always** named `video.mp4` (`VIDEO_FILENAME` constant) to match what `/run/audio` expects (`backend/main.py`); uploaded PDFs are always `material.pdf` (`MATERIAL_FILENAME`).
- `suggestLectureName` / `suggestRecitationName` in `popup.js` duplicate logic from `frontend/src/components/Sidebar.tsx`. If the sidebar's naming convention changes, update both.
- Per-page isolation is by **exact URL match** (full URL including query and hash), not by domain or path prefix — navigating anywhere else in the same tab hides prior captures.
