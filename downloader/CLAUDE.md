# CLAUDE.md — downloader

## What this is

A Chrome extension (Manifest V3) plus a tiny local Node server that together capture video streams from web pages and save them directly into `{DATA_ROOT}/{course}/{lecture}/video.mp4` so the backend's `/run/audio` step can pick them up with no manual file moves. Two source paths:

- **Generic `.mp4` capture** — sniff the browser's network requests, replay the captured headers via `curl`. This is the only thing that works for streaming sites that gate `.mp4` URLs behind short-lived tokens + Referer/Origin checks.
- **YouTube** — captured `.mp4` URLs are useless because YouTube uses DASH-segmented streams; shell out to `yt-dlp` instead, which handles signed URLs and audio/video muxing.

## Running

```bash
npm start         # starts server.js on port 3052 (no deps; uses Node stdlib only)
```

The Chrome extension is loaded unpacked from this folder. `server.js` only accepts requests from one hardcoded extension ID (`EXTENSION_ID`); if you reload the extension and Chrome assigns a new ID, update that constant or CORS will block the popup.

`server.js` reads `../.env` at startup (no `dotenv` dep — tiny inline parser) to pick up `DATA_ROOT`, the same env file the backend uses.

## Architecture

Four pieces, one flow:

1. **`background.js`** (extension service worker) — listens to `webRequest.onSendHeaders` on `<all_urls>`, captures any request whose URL path ends in `.mp4`, resolves the originating tab's URL via `chrome.tabs.get(details.tabId)`, and stashes `{url, headers, capturedAt, pageUrl}` in `chrome.storage.local`. Captures without a resolvable `pageUrl` are dropped. The store is a deduped ring of up to 50 entries (across all tabs); the toolbar badge count is set **per tab** (`setBadgeText({ tabId, text })`) and reflects only that page's captures.

2. **`popup.html` + `popup.js`** — on open:
   - `GET /courses` populates course/lecture autocomplete and pre-fills the lecture name via `suggestLectureName` (mirrors `frontend/src/components/Sidebar.tsx`).
   - Hostname-checks `activeTab.url` against `{youtube.com, www.youtube.com, m.youtube.com, youtu.be}`.
     - **YouTube path:** hides the captured-requests `<select>`, shows the page URL as a readonly field, POSTs `{url, course, lecture, kind}` to `/download-youtube`.
     - **Generic path:** reads `videoRequests` from storage and **filters by exact-match `pageUrl === activeTab.url`** so captures from other pages/tabs never leak in. Renders each capture in a `<select>` prefixed with its size (`[412.3 MB] host … file.mp4`). Sizes are probed lazily with a HEAD request, falling back to `Range: bytes=0-0` GET reading `Content-Range` when HEAD is blocked. Failures render `[?]`; pending probes show `[…]`. On submit, POSTs `{url, headers, course, lecture, kind}` (raw URL + captured headers — not a prebuilt curl string) to `/download`.

3. **`server.js`** — four endpoints:
   - `GET /courses` → `[{name, lectures, recitations}]` by scanning `DATA_ROOT`.
   - `POST /download` → validates inputs (`isSafeName` rejects `/`, `\`, `.`, `..`), `mkdir -p`s the lecture folder, builds curl args from the captured headers (stripping `Range`, `If-Range`, `If-None-Match`, `If-Modified-Since`, `Host`, `Content-Length` — see `SKIP_HEADERS`), forces `--output video.mp4`, and `spawn`s curl (no shell) with `cwd` set to the lecture folder. `--retry 3 --retry-all-errors` covers flaky CDNs that close TLS without `close_notify` mid-stream.
   - `POST /download-youtube` → same input validation + `lectureDir`, but `spawn`s `yt-dlp` with `-o video.%(ext)s --merge-output-format mp4 --no-playlist --js-runtimes node`. No captured headers — yt-dlp manages its own session. Recent yt-dlp needs a JS runtime for YouTube's player script; we point it at the `node` we already have.
   - (On successful download from either path) `notifyFrontend()` fires a non-blocking `POST http://localhost:5173/api/notify` so the Vite SSE handler tells all connected sidebars to re-fetch `/api/tree`. Failure is silent — downloads must succeed even when the frontend isn't running.

4. **Size probes** — `probeContentLength` (curl path, HEAD → ranged-GET fallback) and `probeYoutubeSize` (yt-dlp `--skip-download --print %(filesize,filesize_approx)s` summed across the `bv*+ba/b` format selection) print an expected size to the server log before each download.

Recitations live at `{course}/Recitations/{name}/` to match the backend's `lecture_dir()` convention.

## Why these specific hacks

- **Header replay (`buildCurlArgs`).** Streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin checks. Cloning the browser's exact headers reuses the live session — naive downloading 403s.
- **`SKIP_HEADERS` strips conditional/range headers.** If the original captured request was a ranged segment fetch, replaying `Range:` makes curl save a partial body that lacks the MP4 header at offset 0 and is unplayable.
- **yt-dlp for YouTube.** DASH-segmented streams (separate audio/video tracks behind signed URLs) means the `.mp4`-capture flow gets nothing usable. `yt-dlp` resolves the manifest, downloads both tracks, and muxes to `video.mp4`. **Prerequisite:** `yt-dlp` must be installed system-wide (`pipx install yt-dlp` or `apt install yt-dlp`) — same kind of external-CLI dependency as `ffmpeg` is for the backend. The server doesn't install it.
- **Per-tab badge / per-page filter.** Multiple lectures open in different tabs would otherwise pollute each other's capture list.
- **SSE notify ping.** The browser doesn't know when curl/yt-dlp finished, so the server actively tells the frontend after `child.on('close', code === 0)`.

## Conventions

- ESM only (`"type": "module"` in `package.json`); use `import`, not `require`.
- Keep it dependency-free — `server.js` uses only the Node stdlib. Don't add Express or dotenv.
- Use `execFile` / `spawn` with argv arrays, never `exec` (shell string), so header values containing shell metacharacters can't inject.
- Saved video is **always** named `video.mp4` (`VIDEO_FILENAME` constant) to match what `/run/audio` expects (`backend/main.py`).
- `suggestLectureName` / `suggestRecitationName` in `popup.js` duplicate logic from `frontend/src/components/Sidebar.tsx`. If the sidebar's naming convention changes, update both.
- Per-page isolation is by **exact URL match** (full URL including query and hash), not by domain or path prefix — navigating anywhere else in the same tab hides prior captures.
