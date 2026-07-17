# auto-downloader

Given a **course URL**, this service drives a browser to authenticate (persisted
long-term, like the backend's Google Drive OAuth), discover the course's
recordings, and download them — reusing `server/`'s `/download` +
`/download-youtube` for the actual fetch. Auth, list, expand, and download are
all working.

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
npm start   # HTTP service on port 3053 (src/server.js)
```

The service holds one persistent headless browser per profile and exposes
auth / `/list` / `/list/expand` / `/download-item` / `/close` for the frontend
(CORS: `http://localhost:5173`); it reads the repo-root `.env` for `SERVER_URL`.
Override the port with `AUTODL_PORT` and the headed-login entry URL with
`AUTODL_AUTH_URL`.

The HTTP surface is **mechanism-agnostic**: `/list` and `/list/expand` return
uniform `Item = { ref, title, kind, expandable }` and `/download-item` takes
`{ ref, … }`. The download mechanism (videostream / youtube / zoom) is hidden
inside the opaque `ref` (base64url of the internal `Recording`, see `src/ref.js`)
— the frontend round-trips `ref` and never parses it.

## First-login is headed; reuse is headless

Microsoft login involves MFA, which can't be fully automated:

- **First run / expired session:** a **headed** browser opens so you complete the
  Microsoft login + MFA by hand **once**; the session (`storageState`) is saved
  to `.auth/biu.json`.
- **Every run after:** that saved state loads into a **headless** browser
  silently. If it has expired, the headed login runs again and re-persists.

`.auth/` holds your live session and is gitignored — treat it as a secret.

## More

See `CLAUDE.md` (run instructions + HTTP surface) and `docs/` (auth, browsing,
zoom, and session internals).
