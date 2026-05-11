# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) plus a tiny local Node server that together intercept video stream requests from any web page and save the underlying `.mp4` directly into the right `{DATA_ROOT}/{course}/{lecture}/` folder so the backend pipeline can pick it up with no manual moves.

## Running

```bash
npm start         # starts server.js on port 3052
```

The Chrome extension is loaded unpacked from this folder. The server only accepts requests from one hardcoded extension ID (`EXTENSION_ID` in `server.js`); if you reload the extension and Chrome assigns a new ID, update that constant or CORS will block the popup.

## Architecture

Four pieces, one flow:

1. **`background.js`** (extension service worker) — listens to `webRequest.onSendHeaders` on `<all_urls>`, captures any request whose URL path ends in `.mp4`, looks up the originating tab's URL via `chrome.tabs.get(details.tabId)`, and stashes `{url, headers, capturedAt, pageUrl}` in `chrome.storage.local`. Captures without a resolvable `pageUrl` are dropped. The store is a deduped ring of up to 50 entries (across all tabs); the toolbar badge count is set **per tab** (`setBadgeText({ tabId, text })`) and reflects only that page's captures.
2. **`popup.html` + `popup.js`** — on open:
   - `GET /courses` populates course/lecture autocomplete and pre-fills the lecture name via `suggestName` (mirrors `frontend/src/components/Sidebar.tsx`).
   - Reads `videoRequests` from storage and **filters by exact-match `pageUrl === activeTab.url`** so captures from other pages/tabs never leak in.
   - Renders each capture in a `<select>` prefixed with its size (`[412.3 MB] host … file.mp4`). Sizes are probed lazily with a HEAD request, falling back to a `Range: bytes=0-0` GET to read `Content-Range` when HEAD is blocked. Failures render as `[?]`; pending probes show `[…]`.
   - On submit, POSTs `{url, headers, course, lecture, kind}` (raw URL + captured headers — not a prebuilt curl string) to `/download`.
3. **`server.js`** — two endpoints:
   - `GET /courses` → `[{name, lectures, recitations}]` by scanning `DATA_ROOT`.
   - `POST /download` → validates inputs (`isSafeName` rejects `/`, `\`, `.`, `..`), `mkdir -p`s the lecture folder, builds curl args from the captured headers (stripping `Range`, `If-Range`, `If-None-Match`, `If-Modified-Since`, `Host`, `Content-Length` — see `SKIP_HEADERS`), forces `--output video.mp4`, and `execFile`s curl (no shell) with `cwd` set to the lecture folder. Recitations live at `{course}/Recitations/{name}/` to match the backend's `lecture_dir()` convention.
4. **`.env` loader** — `server.js` reads `../.env` at startup (no dotenv dep — tiny inline parser) to pick up `DATA_ROOT`, the same env file the backend uses.

The header-replay approach is the whole point: streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin checks, so naive downloading fails. By cloning the browser's exact headers we reuse the live session.

Why `SKIP_HEADERS` strips conditional/range headers: if the original captured request was a ranged segment fetch, replaying `Range:` makes curl save a partial body that lacks the MP4 header at offset 0 and is unplayable.

## Conventions

- ESM only (`"type": "module"` in `package.json`); use `import`, not `require`.
- Keep it dependency-free — `server.js` uses only the Node stdlib. Don't add Express or dotenv.
- Use `execFile` (argv array), never `exec` (shell string), so header values containing shell metacharacters can't inject.
- Saved video is **always** named `video.mp4` to match what `/run/audio` expects (`backend/main.py`).
- `suggestName` logic in `popup.js` is duplicated from `Sidebar.tsx`. If the sidebar's naming convention changes, update both.
- Per-page isolation is by **exact URL match** (full URL including query and hash), not by domain or path prefix — navigating anywhere else in the same tab hides prior captures.
