# CLAUDE.md — downloader

## What this is

Three packages that capture lecture videos and PDFs and hand them to the database service, which writes `{DATA_ROOT}/{course}/{lecture}/video.mp4` (or a material PDF) for the backend's pipeline to pick up: a dev-only Chrome extension (Manifest V3, `extension/`), the express helper server (`server/`) and the Playwright auto-downloader (`auto/`). End-user install guide: [README.md](README.md).

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

Both services implement the launch contract — loopback bind, the `FASTSTUDY_PORT` handshake, the `FASTSTUDY_SECRET` check with `GET /health` exempt, the state root — through [`@faststudy/runtime`](../lib/runtime/CLAUDE.md), and resolve their binaries through [`@faststudy/tools`](../lib/tools/CLAUDE.md). Unset `FASTSTUDY_SECRET` (every manual run) means no enforcement and no secret on `server/`'s peer calls.

The Chrome extension is loaded unpacked from `downloader/extension/regular` (the simple variant from `downloader/extension/simple`). It is **dev-only and not part of the packaged build**: `popup.js` hardcodes `http://localhost:3052`, which it cannot learn when the launcher binds an ephemeral port, and it has no bridge to receive `FASTSTUDY_SECRET`, so its calls carry no `X-FastStudy-Secret`. `auto/`'s extractors cover the same sources for a packaged user.

Accordingly the server allowlists an extension origin only when `DOWNLOADER_EXTENSION_ID` is set: a dev must set it to the ID Chrome assigned (there is no default, and it changes when the extension is reloaded), and unset — every packaged run — means the popup is blocked by CORS. Server config and internals live in **`server/CLAUDE.md`**.

## Architecture

The extension has two pieces; the server they hand off to is covered separately (see the pointer section below).

1. **`background.js`** (extension service worker) — listens to `webRequest.onSendHeaders` on `<all_urls>`, captures any request whose URL path ends in `.mp4`, resolves the originating tab's URL via `chrome.tabs.get(details.tabId)`, and stashes `{url, headers, capturedAt, pageUrl}` in `chrome.storage.local`. Captures without a resolvable `pageUrl` are dropped. The store is a deduped ring of up to 50 entries (across all tabs); the toolbar badge count is set **per tab** (`setBadgeText({ tabId, text })`) and reflects only that page's captures.

2. **`popup.html` + `popup.js`** — on open:
   - `GET /courses` populates course/lecture autocomplete and pre-fills the lecture name via `suggestLectureName` (mirrors `frontend/src/features/lectures/utils/nextName.ts`).
   - Hostname-checks `activeTab.url` against `{youtube.com, www.youtube.com, m.youtube.com, youtu.be}`.
     - **YouTube path:** hides the captured-requests `<select>`, shows the page URL as a readonly field, POSTs `{url, course, lecture, kind}` to `/download-youtube`.
     - **Generic path:** reads `videoRequests` from storage and **filters by exact-match `pageUrl === activeTab.url`** so captures from other pages/tabs never leak in. Renders each capture in a `<select>` prefixed with its size (`[412.3 MB] host … file.mp4`). Sizes are probed lazily via `POST /probe-size` (the server uses Node `http`, which can send the captured `Cookie` header that `fetch` forbids); the probe does HEAD then falls back to a `Range: bytes=0-0` GET reading `Content-Range`. Failures render `[?]`; pending probes show `[…]`. On submit, POSTs `{url, headers, course, lecture, kind}` (raw URL + captured headers — not a prebuilt curl string) to `/download`.
   - **PDF path:** if `activeTab.url` ends in `.pdf`, shows the URL readonly; on submit the popup `fetch`es the PDF itself (`credentials: 'include'`, so the user's session cookies authenticate) and POSTs the bytes to `/upload-pdf?course=&lecture=&kind=`. Only one of {video, PDF, empty} is shown — video wins; PDF mode pre-fills the _latest_ existing lecture name (attach material), not the next one.

## The two services

| Package   | Port | What it is                                                                                                   | Docs                                   |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `server/` | 3052 | express helper: runs every download as a job (curl replay, yt-dlp, plain fetch), owns section bulk runs, forwards files to the database | [server/CLAUDE.md](server/CLAUDE.md) |
| `auto/`   | 3053 | Playwright service: Moodle WS token auth, course discovery, and resolving a row into download targets — a separate package so Playwright never leaks into `server/` | [auto/CLAUDE.md](auto/CLAUDE.md) |

## Service edges

The graph is acyclic: `server/` → **auto/** (3053) to resolve a discovery row into download
targets (and to re-resolve one whose cached token went stale), → **database** (8001) for every
file it saves, and → **backend** (8000) both to announce a stored video (`POST /video-arrived`,
which is where auto-run is decided) and for download duration samples (`POST /timing`, per-tool
ETA buckets — [JOBS.md](server/docs/JOBS.md)). `auto/` calls nothing of ours. From outside, the extension
popup calls `server/`, and the frontend calls `server/` for every download (start, job and run events,
resync) and `auto/` for listing, auth and passcodes.

## Failure envelope

Every non-2xx body either service answers is `{error, code, params}`, and every failed download job
carries the same `code`/`params` beside its `message` on `GET /jobs`. `code` is a lower_snake_case
name for the failure, `params` is flat (strings, numbers, booleans, null — no nesting, no prose), and
text from outside this repo (yt-dlp, curl, undici, Playwright, Moodle, the database service's body)
rides as the reserved `detail` param. `error`/`message` stays English: it is the developer-facing
description and the frontend's fallback for a code it has no sentence for.

`auto/`'s four typed refusals keep their `status` and `message` on top of that, so the frontend's
existing branch on `status` is untouched. The full vocabulary is in the repo-root
[`docs/ERROR-CODES.md`](../docs/ERROR-CODES.md); a request-validation body carries `invalid_request`
with the offending `field` and deliberately has no catalog row.

The emoji prefixes are `progress.js`'s console wrappers only — nothing emoji-prefixed reaches an
HTTP body or a job message.

## Why these specific hacks (extension)

- **Per-tab badge / per-page filter.** Multiple lectures open in different tabs would otherwise pollute each other's capture list. (The download/curl/yt-dlp hacks live in `server/docs/DOWNLOAD.md`.)

## Conventions

- The Node packages (`server/`, `auto/`) use npm freely; **only the Chrome extension** (`extension/`) must avoid dependencies (MV3 constraint).
- `suggestLectureName` / `suggestRecitationName` in `popup.js` duplicate logic from `frontend/src/features/lectures/utils/nextName.ts`. If the naming convention changes, update both.
- Per-page isolation is by **exact URL match** (full URL including query and hash), not by domain or path prefix — navigating anywhere else in the same tab hides prior captures.
- Server-specific conventions (argv-array spawn, always `video.mp4`, database-allocated material names, name canonicalization) live in [server/CLAUDE.md](server/CLAUDE.md).
- Only pure logic is unit-tested (`npm --prefix downloader/auto test`, `npm --prefix downloader/server test`, node's built-in runner, no deps); the download paths depend on live tokens, Referer/Origin checks, and yt-dlp behavior no diff review can predict — exercise the real _endpoint_, but never against real _data_.
- **Never make a live request to `lemida.biu.ac.il` (or any university host) to verify a change.** Exercise the code against fixtures and a stubbed `globalThis.fetch` in `auto/test/*.test.js`, plus curls against the local services. Traffic that looks automated trips the Radware block for minutes, which then breaks the user's own real downloads ([MOODLE.md](auto/docs/MOODLE.md)).
- A transient upstream refusal — bot-protection challenge, rate limit, temporary block — gets a typed error and a distinct HTTP status, never a retry loop, backoff or client-side throttling. `WsBlockedError` → `503 {status:'blocked', message}` is the shape to reuse: waiting out a block inside a request only holds the connection open, and throttling every normal call to avoid a rare one is the wrong trade.
