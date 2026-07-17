# Persistent browser sessions

The service holds long-lived browsers (the ~1–2s launch + auth-context build is paid once), not one-per-request. Model in `src/browserSession.js`.

- **Per-profile DI.** `BrowserSession` takes an injected launcher fn — it never hardcodes a launch. `getSession(profile)` lazily builds and keeps **one browser+context+page per profile**, each with its own idle timer. An extractor's `browserProfile` selects which profile it runs on (`'plain'` default, `ZoomExtractor` → `'zoom'`).
- **`withLock(fn)`** — a small async mutex serializing only the quick navigate+sniff so one call's nav can't abort another's. The heavy download runs afterward in `server/`, so parallel downloads still overlap end-to-end. `rebuildContext`/`open` are deliberately NOT under `withLock` (the auth gate already orders login-vs-browse; a shared lock risks deadlock).
- **Not closed between requests / on course switch** — switching course is just `goto()`. `rebuildOpenSessions(state)` swaps every open session's context to fresh cookies after `/auth/complete` (same browser processes).
- **Idle timeout** (`IDLE_TIMEOUT_MS`, ~45 min) is a leak-safety valve only; a session re-opens lazily on its next call. `closeAllSessions()` (on `/close` and `SIGINT`/`SIGTERM`) closes every session and stops the managed Xvfb.

## Launch matrix

Zoom's recording player is the only path needing the heavyweight browser.

| Profile / path | Browser | Display | Visible |
|---|---|---|---|
| `'plain'` — `/list`, `/list/expand`, videostream (`browserLaunch.js`, plain bundled Chromium, no stealth) | headless | none | no |
| `'zoom'` — `ZoomExtractor` capture (`zoomBrowser.js`) | system Chrome `channel:'chrome'` + puppeteer-extra stealth + `--disable-blink-features=AutomationControlled` + `ignoreDefaultArgs:['--enable-automation']`, `headless:false` | managed **Xvfb** | no (virtual) |
| Microsoft login (`MicrosoftAuth.connect()`, `launchBrowser` headed) | bundled Chromium → `channel:'chrome'` on launch failure | real WSLg display | **yes — MFA** |

See `ZOOM.md` for why the zoom profile is shaped this way.
