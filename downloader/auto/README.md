# auto-downloader

Given a **course URL**, this service authenticates to Moodle's Web-Services API
(a long-lived token, persisted like the backend's Google Drive OAuth), discovers
the course's recordings, and downloads them — reusing `server/`'s `/download` +
`/download-youtube` for the actual fetch.

A **separate package** with its own `node_modules` so Playwright never leaks into
the dependency-free `server/`.

## Setup

```bash
npm install
npx playwright install chromium
```

Zoom recording capture additionally needs `Xvfb` and system Google Chrome
installed.

## Run

```bash
npm start   # HTTP service on port 3053 (src/http/server.js)
```

The service holds one persistent browser per profile (the zoom profile runs headed
under a virtual display — see `docs/SESSIONS.md`) and exposes
auth / `/list` / `/list/expand` / `/download-item` / `/close` for the frontend
(CORS: `http://localhost:5173`); it reads the repo-root `.env` for `SERVER_URL`.
Override the port with `AUTODL_PORT`.

The HTTP surface is **mechanism-agnostic**: `/list` and `/list/expand` return
uniform `Item = { ref, title, kind, expandable, section }` and `/download-item` takes
`{ ref, … }`. The download mechanism (videostream / youtube / zoom) is hidden
inside the opaque `ref` (base64url of the internal `Recording`, see `src/lib/ref.js`)
— the frontend round-trips `ref` and never parses it.

## One MFA, then a long-lived token

Login involves MFA, which can't be automated — but you only do it once:

- **First run / expired token:** a **headed** browser opens so you complete the
  Microsoft login + MFA by hand **once**; the Moodle Web-Services token is saved
  to `.auth/biu-token.json`.
- **Every run after:** that token drives Moodle's stateless REST API with no
  browser and no re-MFA (Moodle default lifetime: 12 weeks). When it expires the
  UI shows Reconnect and one more MFA re-grabs it.

`.auth/` holds your live token (and any zoom passcodes) and is gitignored — treat
it as a secret.

## More

See `CLAUDE.md` (run instructions + HTTP surface) and `docs/` (auth, browsing,
zoom, and session internals).
