# Persistent browser sessions

The service holds long-lived browsers (the ~1–2s launch + context build is paid once), not one-per-request. Model in `src/browser/browserSession.js`.

- **Per-profile DI.** `BrowserSession` takes an injected launcher fn — it never hardcodes a launch. `getSession(profile)` lazily builds and keeps **one browser+context+page per profile**, each with its own idle timer. An extractor's `browserProfile` selects which profile it runs on (`'plain'` default, `ZoomExtractor` → `'zoom'`).
- **`open()` injects no cookies.** The context starts blank. The `'plain'` profile authenticates **on demand** at download time via Moodle autologin (`docs/AUTH.md`, `docs/MOODLE.md`); the `'zoom'` profile is passcode-gated, never BIU-auth.
- **Autologin-cookie freshness cache.** Autologin is rate-limited (~1/user/6 min), so `isAuthed()` / `markAuthed(ttl)` skip a re-login while an earlier one is still within TTL (~20 min). Reset on `close()` (the context, and its cookie, is gone).
- **`withLock(fn)`** — a small async mutex serializing only the quick navigate+sniff so one call's nav can't abort another's. The heavy download runs afterward in `server/`, so parallel downloads still overlap end-to-end. `open()` is deliberately NOT under `withLock` (it's a no-op once open; a shared lock risks deadlock).
- **Not closed between requests / on course switch** — switching course is just `goto()`.
- **Idle timeout** (`IDLE_TIMEOUT_MS`, ~45 min) is a leak-safety valve only; a session re-opens lazily on its next call. `closeAllSessions()` (on `/close` and `SIGINT`/`SIGTERM`) closes every session and stops the managed Xvfb.

## Launch matrix

Zoom's recording player is the only path needing the heavyweight browser.

| Profile / path | Browser | Display | Visible |
|---|---|---|---|
| `'plain'` — videostream `.mp4` sniff only (`/list` and `/list/expand` need no browser; `browser/browserLaunch.js`, plain bundled Chromium, no stealth) | headless | none | no |
| `'zoom'` — `ZoomExtractor` capture (`browser/zoomBrowser.js`) | system Chrome `channel:'chrome'` + puppeteer-extra stealth + `--disable-blink-features=AutomationControlled` + `ignoreDefaultArgs:['--enable-automation']`, `headless:false` | managed **Xvfb** | no (virtual) |
| One-time token grab (`MoodleToken.connect()`, `launchBrowser` headed) | bundled Chromium → `channel:'chrome'` on launch failure | real WSLg display | **yes — MFA once** |

See `ZOOM.md` for why the zoom profile is shaped this way.
