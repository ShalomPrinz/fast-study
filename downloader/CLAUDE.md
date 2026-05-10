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

1. **`background.js`** (extension service worker) — listens to `webRequest.onSendHeaders` on `<all_urls>`, captures any `media`-type request or URL containing `.mp4`, stashes URL + request headers in `chrome.storage.local`, and sets a red badge.
2. **`popup.html` + `popup.js`** — on open, fetches `GET /courses` to populate course/lecture autocomplete and pre-fills the lecture name using the same `suggestName` logic as `frontend/src/components/Sidebar.tsx` (next `Lecture N` / `Recitation N`). Reconstructs a `curl` command from the stashed request (preserving every original header so auth/referrer-protected streams work) and POSTs `{command, course, lecture, kind}` to the server.
3. **`server.js`** — two endpoints:
   - `GET /courses` → `[{name, lectures, recitations}]` by scanning `DATA_ROOT`.
   - `POST /download` → validates inputs, `mkdir -p`s the lecture folder, rewrites curl's `--output` flag to `video.mp4`, and `exec`s it with `cwd` set to that folder. Recitations live at `{course}/Recitations/{name}/` to match the backend's `lecture_dir()` convention.
4. **`.env` loader** — `server.js` reads `../.env` at startup (no dotenv dep — tiny inline parser) to pick up `DATA_ROOT`, the same env file the backend uses.

The header-replay approach is the whole point: streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin checks, so naive downloading fails. By cloning the browser's exact headers we reuse the live session.

## Conventions

- ESM only (`"type": "module"` in `package.json`); use `import`, not `require`.
- Keep it dependency-free — `server.js` uses only the Node stdlib. Don't add Express or dotenv.
- Saved video is **always** named `video.mp4` to match what `/run/audio` expects (`backend/main.py`).
- `suggestName` logic in `popup.js` is duplicated from `Sidebar.tsx`. If the sidebar's naming convention changes, update both.
