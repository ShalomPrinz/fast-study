# auto-downloader

Given a **course URL**, this service drives a headless browser to authenticate
(persisted long-term, like the backend's Google Drive OAuth), navigate the
course, and **discover + list** the downloadable lecture videos. MVP is
**discover + list only** — no downloading yet (that reuses `server.js`'s
`/download`, wired in a later phase).

This is a **separate package** with its own `node_modules` so Playwright never
leaks into the dependency-free `server.js`.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
node src/index.js <courseUrl>
```

Prints a numbered list of discovered videos and writes `captures/<slug>.json`
for the next phase to consume.

## First-login is headed; reuse is headless

Microsoft login involves MFA, which can't be fully automated:

- **First run / expired session:** a **headed** browser opens so you can complete
  the Microsoft login + MFA by hand **once**; the session (`storageState`) is
  then saved to `.auth/biu.json`.
- **Every run after:** that saved state loads into a **headless** browser
  silently. If it has expired, the headed login runs again and re-persists.

`.auth/` holds your live session and is gitignored — treat it as a secret.

## Status

Scaffold only. The Microsoft login flow and the BIU site-specific DOM/enumeration
are `TODO` stubs (see `AUTO_DOWNLOADER_PLAN.md` §9 for the site-specific unknowns
a human must fill in against the live pages).
