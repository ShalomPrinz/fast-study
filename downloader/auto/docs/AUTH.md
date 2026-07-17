# Microsoft auth

`MicrosoftAuth` (`src/auth/MicrosoftAuth.js`), one instance cached **per university** (never evicted, so `connect`→`complete` share the in-memory headed browser). Direct analogue of the backend's cached Google Drive OAuth token.

## connect / complete / status

- `connect(entryUrl)` — opens the **headed** login (MFA can't be automated) and returns immediately.
- `complete()` — persists `storageState` to `.auth/biu.json` and closes the headed browser.
- `status()` — cheap probe (state file exists + cookie-expiry heuristic), no browser launch. The real redirect-to-login check happens on `/list`.

First login is headed; every run after reuses the persisted state **headlessly** — until it expires, when the headed login runs again.

## Silent SSO recovery

The cookie heuristic can't see a server-side session kill, so runtime navs go through `session.gotoAuthenticated(url, auth)`. On a login/enrol bounce it first waits (bounded, `SILENT_REAUTH_TIMEOUT_MS` ~12s) for the page to auto-redirect back: the short Moodle session can idle out while the persistent Microsoft/Entra (AAD) cookie is still alive, so SSO often completes with no MFA. On success it re-saves the refreshed rolling cookies (`auth.saveState`, best-effort) so the window keeps extending. Only when recovery times out (credentials genuinely required) does the caller call `auth.markExpired()`.

`markExpired()` makes the server the **source of truth**: the next `/auth/status` reports `expired:true` until the next successful `complete()` clears it. This relies on the per-university instance staying cached.

## Enrol gate → reconnect

An expired BIU session doesn't bounce to a Microsoft login — Moodle silently redirects `course/view.php` to its enrol gate (`/enrol/index.php`, guest access, zero activities). `isLoginUrl` catches it (alongside the Microsoft login hosts) so `/list` steers the UI to Reconnect (`401 {status:'reconnect'}`) instead of returning an empty list.

## Auth gate (`server.js`)

Per-university barrier (in-memory, mirrors `authInstances`) that browsing endpoints (`/list`, `/list/expand`, and the videostream branch of `/download-item` — NOT the zoom branch) `await` before touching cookies or the browser.

- `/auth/connect` **closes** it; `/auth/complete` **opens** it *after* `complete()` + `rebuildOpenSessions()`.
- **Why:** `open()` is a no-op when already open and skips `withLock`, so a `/list` fired during "finishing…" used to navigate on the stale pre-login context → login bounce → `markExpired()` flipped a *permanent* false "expired". Now such a `/list` parks (async, zero-CPU) until the rebuild finishes and runs on fresh cookies.
- **Released** on success (`/auth/complete`), on **abandon** (the headed browser's `disconnected` event → `connect`'s `onCancel` → immediate open, so a parked request wakes, re-checks `status()` still-expired, and reconnects), or as a **backstop** ~3 min (a `.unref()` timer, for the pathological case where the browser neither completes nor disconnects — kept rare so a slow-but-legitimate MFA login isn't cut early).
