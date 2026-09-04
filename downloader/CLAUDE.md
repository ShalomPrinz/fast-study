# CLAUDE.md — downloader

## What this is

A Chrome extension (Manifest V3) plus a tiny local Node server that together capture video streams from web pages and hand them off to the database service, which writes `{DATA_ROOT}/{course}/{lecture}/video.mp4` so the backend's `/run/audio` step can pick them up with no manual file moves.

## Source paths

`extension/simple/` is an extension-only variant that needs no server and saves to `Downloads/`.

- **Generic `.mp4` capture** — sniff the browser's network requests, replay the captured headers via `curl`. This is the only thing that works for streaming sites that gate `.mp4` URLs behind short-lived tokens + Referer/Origin checks.
- **YouTube / Google Drive** — captured `.mp4` URLs are useless because YouTube uses DASH-segmented streams; shell out to `yt-dlp` instead, which handles signed URLs and audio/video muxing. The same path serves public Google Drive file links whose filename says they're video (`auto/`'s `google-drive` strategy, which probes the name first and sends a Drive PDF down the material path instead).
- **PDF** — when the active tab is a `.pdf`, the popup fetches it directly (with the user's cookies) and uploads it as one of the lecture's materials; no header replay needed since PDFs aren't token-gated.

## Running

```bash
npm --prefix downloader/server start   # starts the express server on port 3052
npm --prefix downloader/auto start     # starts auto/app.js on port 3053 (the HTTP service; needs Playwright)
```

Both services bind `127.0.0.1` only and print `FASTSTUDY_PORT=<n>` as their first stdout line; `FASTSTUDY_PORT` in the environment overrides the default port, and `0` asks for an ephemeral one the launcher reads back off that line.

`FASTSTUDY_SECRET` in the environment makes both reject any request that carries it neither as an `X-FastStudy-Secret` header nor as a `?secret=` query parameter (the query route exists for `EventSource`, which cannot set headers) — `401 {"error":"unauthorized"}`, or an empty `401` typed `text/event-stream` when the request accepts SSE, since Chromium reports any other MIME on an `EventSource` as a bare `onerror`. `GET /health` is the sole exemption, so the launcher can tell a wrong secret from a dead child. Unset (every manual run) means no enforcement, and `server/` then also sends no secret on its calls to `auto/`, the database and the backend.

The Chrome extension is loaded unpacked from `downloader/extension/regular` (the simple variant from `downloader/extension/simple`). The server only accepts requests from one extension ID (`DOWNLOADER_EXTENSION_ID`, env-overridable); if you reload the extension and Chrome assigns a new ID, set that env var or CORS blocks the popup. Server config and internals live in **`server/CLAUDE.md`**.

## Architecture

The extension has two pieces; the server they hand off to is covered separately (see the pointer section below).

1. **`background.js`** (extension service worker) — listens to `webRequest.onSendHeaders` on `<all_urls>`, captures any request whose URL path ends in `.mp4`, resolves the originating tab's URL via `chrome.tabs.get(details.tabId)`, and stashes `{url, headers, capturedAt, pageUrl}` in `chrome.storage.local`. Captures without a resolvable `pageUrl` are dropped. The store is a deduped ring of up to 50 entries (across all tabs); the toolbar badge count is set **per tab** (`setBadgeText({ tabId, text })`) and reflects only that page's captures.

2. **`popup.html` + `popup.js`** — on open:
   - `GET /courses` populates course/lecture autocomplete and pre-fills the lecture name via `suggestLectureName` (mirrors `frontend/src/features/lectures/utils/nextName.ts`).
   - Hostname-checks `activeTab.url` against `{youtube.com, www.youtube.com, m.youtube.com, youtu.be}`.
     - **YouTube path:** hides the captured-requests `<select>`, shows the page URL as a readonly field, POSTs `{url, course, lecture, kind}` to `/download-youtube`.
     - **Generic path:** reads `videoRequests` from storage and **filters by exact-match `pageUrl === activeTab.url`** so captures from other pages/tabs never leak in. Renders each capture in a `<select>` prefixed with its size (`[412.3 MB] host … file.mp4`). Sizes are probed lazily via `POST /probe-size` (the server uses Node `http`, which can send the captured `Cookie` header that `fetch` forbids); the probe does HEAD then falls back to a `Range: bytes=0-0` GET reading `Content-Range`. Failures render `[?]`; pending probes show `[…]`. On submit, POSTs `{url, headers, course, lecture, kind}` (raw URL + captured headers — not a prebuilt curl string) to `/download`.
   - **PDF path:** if `activeTab.url` ends in `.pdf`, shows the URL readonly; on submit the popup `fetch`es the PDF itself (`credentials: 'include'`, so the user's session cookies authenticate) and POSTs the bytes to `/upload-pdf?course=&lecture=&kind=`. Only one of {video, PDF, empty} is shown — video wins; PDF mode pre-fills the _latest_ existing lecture name (attach material), not the next one.

## Local helper server (`server/`, port 3052)

`server/` is the Node (express) server the extension talks to over HTTP. Given a captured `.mp4` (+ headers), a YouTube URL, or PDF bytes, it downloads/forwards the file to the database service (which owns the on-disk layout, including `?kind=recitation`). It also owns each section's bulk "download all" — the queue, its progress and its passcode pause live in the server, so a run survives the page (`server/docs/RUNS.md`). It is documented in its own **`server/CLAUDE.md`** (run command, config, endpoint table, module layout) with the deep logic in **`server/docs/`** (`DOWNLOAD.md`, `PROGRESS.md`, `JOBS.md`, `RUNS.md`, `DATABASE.md`). Don't restate that here.

## Auto-downloader HTTP service (`auto/`, port 3053)

`auto/` is a **separate package** (its own `node_modules`) so Playwright and its browser binaries never leak into `server/`'s much lighter dependency set. Given a course URL it authenticates via a long-lived Moodle Web-Services token (one-time headed grab), discovers the recordings (and the course's PDF handouts), and resolves any of them into the download targets `server/` then fetches (`POST /resolve`). It is documented in its own **`auto/CLAUDE.md`** (what it is, how to run it, the mechanism-agnostic HTTP surface + endpoint table) with the deep logic in **`auto/docs/`** (`SESSIONS.md`, `ZOOM.md`, `BROWSING.md`, `AUTH.md`, `MOODLE.md`). Don't restate that here.

## Service edges

The graph is acyclic: `server/` → **auto/** (3053) to resolve a discovery row into download
targets (and to re-resolve one whose cached token went stale), → **database** (8001) for every
file it saves, and → **backend** (8000) both to announce a stored video (`POST /video-arrived`,
which is where auto-run is decided) and for download duration samples (`POST /timing`, per-tool
ETA buckets — `server/docs/JOBS.md`). `auto/` calls nothing of ours. From outside, the extension
popup calls `server/`, and the frontend calls `server/` for every download (start, job and run events,
resync) and `auto/` for listing, auth and passcodes.

## Why these specific hacks (extension)

- **Per-tab badge / per-page filter.** Multiple lectures open in different tabs would otherwise pollute each other's capture list. (The download/curl/yt-dlp hacks live in `server/docs/DOWNLOAD.md`.)

## Conventions

- The Node packages (`server/`, `auto/`) use npm freely; **only the Chrome extension** (`extension/`) must avoid dependencies (MV3 constraint).
- `suggestLectureName` / `suggestRecitationName` in `popup.js` duplicate logic from `frontend/src/features/lectures/utils/nextName.ts`. If the naming convention changes, update both.
- Per-page isolation is by **exact URL match** (full URL including query and hash), not by domain or path prefix — navigating anywhere else in the same tab hides prior captures.
- Server-specific conventions (argv-array spawn, always `video.mp4`, database-allocated material names, probe-on-raw-http) live in `server/CLAUDE.md`.
- Only pure logic is unit-tested (`npm --prefix downloader/auto test`, `npm --prefix downloader/server test`, node's built-in runner, no deps); the download paths depend on live tokens, Referer/Origin checks, and yt-dlp behavior no diff review can predict — exercise the real _endpoint_, but never against real _data_.
