# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome extension (Manifest V3) plus a tiny local Node server that together intercept video stream requests from any web page and download the underlying `.mp4` to disk via `curl`. It exists to feed the `fast_study` pipeline in the parent directory — downloads land in `../` (the `fast_study` root) so `main.py` can pick them up.

## Running

```bash
npm start         # starts server.js on port 3052
```

The Chrome extension is loaded unpacked from this folder. The server only accepts requests from one hardcoded extension ID (`EXTENSION_ID` in `server.js`); if you reload the extension and Chrome assigns a new ID, update that constant or CORS will block the popup.

## Architecture

Three pieces, one flow:

1. **`background.js`** (extension service worker) — listens to `webRequest.onSendHeaders` on `<all_urls>`, captures any `media`-type request or URL containing `.mp4`, stashes URL + request headers in `chrome.storage.local`, and sets a red badge.
2. **`popup.html` + `popup.js`** — on open, reads the stashed request, reconstructs an equivalent `curl` command (preserving every original header so auth/referrer-protected streams work), and POSTs it to the local server when the user clicks Download.
3. **`server.js`** — single HTTP endpoint `POST /download` that validates the body starts with `curl` and `exec`s it with `cwd: DOWNLOAD_DIR`. `DOWNLOAD_DIR` resolves to the parent folder (`fast_study/`) via `path.resolve(__dirname, '..')`.

The header-replay approach is the whole point: streaming sites gate `.mp4` URLs behind short-lived tokens and Referer/Origin checks, so naive downloading fails. By cloning the browser's exact headers we reuse the live session.

## Conventions

- ESM only (`"type": "module"` in `package.json`); use `import`, not `require`.
- Keep it dependency-free — `server.js` uses only the Node stdlib (`node:http`, `node:child_process`, etc.). Don't add Express or similar.
