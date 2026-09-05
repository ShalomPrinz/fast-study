# auto-downloader

Given a **course URL**, this service authenticates to Moodle's Web-Services API
(a long-lived token, persisted like the backend's Google Drive OAuth), discovers
the course's recordings, and resolves them into the download targets `server/`
then fetches.

A **separate package** with its own `node_modules` so Playwright and its browser
binaries never leak into `server/`'s much lighter dependency set.

## Setup

```bash
npm install
npx playwright install chromium
```

**System Google Chrome is required** — every browser here launches it, and bundled
Chromium is only a fallback for the plain profile. On Linux, zoom recording capture
additionally needs `Xvfb`; on Windows the window is hidden off-screen instead.

## Run

```bash
npm start   # HTTP service on port 3053 (src/http/server.js)
```

The service holds one persistent browser per profile (the zoom profile runs headed
but hidden — see `docs/SESSIONS.md`) and exposes
auth / `/list` / `/list/expand` / `/close` for the frontend (CORS:
`http://localhost:5173` and `app://bundle`) and `/resolve` for `server/`. It listens on `127.0.0.1`
only; override the port with `AUTODL_PORT` in the repo-root `.env`, or with
`FASTSTUDY_PORT` in the environment, which wins.

The HTTP surface is **mechanism-agnostic**: `/list` and `/list/expand` return
uniform `Item = { ref, title, kind, expandable, section }` and `/resolve` takes
`{ ref, … }`. The download mechanism (videostream / youtube / zoom) is hidden
inside the opaque `ref` (base64url of the internal `Recording`, see `src/lib/ref.js`)
— the frontend round-trips `ref` and never parses it.

## One MFA, then a long-lived token

Login involves MFA, which can't be automated — but you only do it once:

- **First run / expired token:** a **headed** browser opens so you complete the
  Microsoft login + MFA by hand **once**; the Moodle Web-Services token is saved
  to `auth/biu-token.json` under the state root.
- **Every run after:** that token drives Moodle's stateless REST API with no
  browser and no re-MFA (Moodle default lifetime: 12 weeks). When it expires the
  UI shows Reconnect and one more MFA re-grabs it.

The state root — `.state/` at the repo root, or wherever `FASTSTUDY_STATE_DIR`
points — holds your live token (and any zoom passcodes) and is gitignored; treat
it as a secret.

## More

See `CLAUDE.md` (run instructions + HTTP surface) and `docs/` (auth, browsing,
zoom, and session internals).
