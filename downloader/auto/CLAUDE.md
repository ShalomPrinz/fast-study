# CLAUDE.md — auto (auto-downloader)

> **Docs describe the CURRENT state, not how we got here.** Never reference a `*PLAN.md`, a phase/step number, or "was TODO / now done". When behavior changes, edit the affected line to read as if it always worked that way. History lives in git, not in these docs or in `src/` comments.

## What this is

A Playwright HTTP service that, given a **course URL**, authenticates to Moodle's Web-Services API (a one-time headed token grab, then a long-lived stateless token — the Google-Drive-refresh-token model), discovers the course's recordings via that WS API, and downloads them — reusing `server/`'s `/download` + `/download-youtube` for the actual fetch. A **separate package** with its own `node_modules` so Playwright never leaks into the dependency-free `server/`. Auth + list + expand + download are all implemented.

## Run

```bash
npm --prefix downloader/auto start   # HTTP service, app.js
npx playwright install chromium      # once, for the plain profile
```

Port **3053** (`AUTODL_PORT`). Reads the repo-root `.env` (`src/lib/config.js`) for `SERVER_URL` (default `http://localhost:3052`) — the `server/` base it POSTs downloads to. CORS allows only the Vite origin `http://localhost:5173` (unlike `server/`, locked to the extension ID). Zoom capture also needs `Xvfb` + system Google Chrome installed.

## HTTP surface

Mechanism-agnostic: `/list` and `/list/expand` return uniform `Item = { ref, title, kind, expandable, section }` (`section` = the Moodle section heading, display metadata for grouping, `''` when unnamed); `/download-item` takes `{ ref, … }`. The download mechanism is hidden inside the opaque `ref` (base64url `Recording`). See `docs/BROWSING.md`.

| Endpoint | Body | Returns |
|---|---|---|
| `GET /auth/status` | — | `{ connected, expired }` |
| `POST /auth/connect` | `{}` | `{ status:'pending' }` (headed token grab opens) |
| `POST /auth/complete` | — | `{ connected:true }` (persists the Moodle WS token) |
| `POST /list` | `{ courseUrl }` | `{ items }` |
| `POST /list/expand` | `{ ref }` | `{ items }` (resolve one expandable item → children) |
| `POST /download-item` | `{ ref, course, name, kind }` | `{ ok }` |
| `POST /zoom/passcode` | `{ course, name?, passcode, scope }` | `{ ok:true }` (store a zoom passcode; `scope:'course'\|'lecture'`) |
| `POST /close` | — | `{ ok:true }` (close the persistent browser) |

`401 {status:'reconnect'}` = the Moodle WS token is missing or a call returned `invalidtoken`. `422 {status:'unsupported'}` = the source genuinely can't be handled: a `url` module target that is neither a YouTube playlist nor a public Google Drive file (a Drive file that isn't shared "anyone with the link" reports the sharing cause and the URL). `409 {status:'passcode', reason, course, name}` = zoom passcode `missing` (none stored) or `incorrect` (stored one won't clear the gate); save one via `POST /zoom/passcode` and retry.

## Deep logic → `docs/`

- **`docs/SESSIONS.md`** — persistent per-profile browsers, `withLock` mutex, idle timeout, the launch matrix.
- **`docs/ZOOM.md`** — why zoom capture needs system Chrome + stealth + managed Xvfb; the UA/GPU constraints; passcode gate; before/after-break split.
- **`docs/BROWSING.md`** — the merged WS-contents + zoom-summary parsers, keyword gating, the `Item`/`ref` contract, lazy playlist expansion. Strategies: `videostream` (in-site .mp4), `youtube-playlist`, `google-drive` (single Drive file, yt-dlp), `zoom`.
- **`docs/AUTH.md`** — the Moodle WS token provider (`connect`/`complete`/`status`), `markExpired` → reconnect, on-demand autologin for videostream. Protocol details in **`docs/MOODLE.md`**.

Dev-stack wiring: the root `npm run dev` runs this as the `AutoDL` (cyan) `concurrently` process.
