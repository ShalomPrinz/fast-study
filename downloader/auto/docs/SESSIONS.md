# Persistent browser sessions

The service holds long-lived browsers (the ~1–2s launch + context build is paid once), not one-per-request. Model in `src/browser/browserSession.js`.

- **Per-profile DI.** `BrowserSession` takes an injected launcher fn — it never hardcodes a launch. `getSession(profile)` lazily builds and keeps **one browser+context+page per profile**, each with its own idle timer. An extractor's `browserProfile` selects which profile it runs on (`'plain'` default, `ZoomExtractor` → `'zoom'`).
- **`open()` injects no cookies.** The context starts blank. The `'plain'` profile authenticates **on demand** at download time via Moodle autologin (`docs/AUTH.md`, `docs/MOODLE.md`); the `'zoom'` profile is passcode-gated, never BIU-auth.
- **Autologin-cookie freshness cache.** Autologin is rate-limited (~1/user/6 min), so `isAuthed()` / `markAuthed(ttl)` skip a re-login while an earlier one is still within TTL (~20 min). Reset on `close()` (the context, and its cookie, is gone).
- **`withLock(fn)`** — a small async mutex serializing only the quick navigate+sniff so one call's nav can't abort another's. The heavy download runs afterward in `server/`, so parallel downloads still overlap end-to-end. `open()` is deliberately NOT under `withLock` (it's a no-op once open; a shared lock risks deadlock).
- **Not closed between requests / on course switch** — switching course is just `goto()`.
- **Idle timeout** (`IDLE_TIMEOUT_MS`, ~45 min) is a leak-safety valve only; a session re-opens lazily on its next call. `closeAllSessions()` (on `/close` and `SIGINT`/`SIGTERM`) closes every session and stops the managed Xvfb (Linux).

## Launch matrix

Zoom's recording player is the only path needing the heavyweight browser.

| Profile / path                                                                                                                 | Browser                                                                                                                                                     | Display                                    | Visible            |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------ |
| `'plain'` — videostream `.mp4` sniff only (`/list` and `/list/expand` need no browser; `browser/browserLaunch.js`, no stealth) | the resolved channel → bundled Chromium on launch failure                                                                                                   | none                                       | no                 |
| `'zoom'` — `ZoomExtractor` capture (`browser/zoomBrowser.js`)                                                                  | the resolved channel + puppeteer-extra stealth + `--disable-blink-features=AutomationControlled` + `ignoreDefaultArgs:['--enable-automation']`, `headless:false` | Xvfb (Linux) / off-screen window (Windows) | no                 |
| One-time token grab (`MoodleToken.connect()`, `launchBrowser` headed)                                                          | the resolved channel → bundled Chromium on launch failure                                                                                                   | real desktop                               | **yes — MFA once** |

## Which browser (`browser/browserChannel.js`)

Both launchers build their own options — they genuinely differ, and only the zoom one is forbidden a bundled-Chromium fallback (`ZOOM.md`) — but they share **one** answer to "which browser": `resolveBrowserChannel()` tries `channel:'chrome'`, then `channel:'msedge'`, and returns the first that launches as `{ channel, browser }` (`browser` = display name).

Playwright exposes no public API that resolves a channel's executable path — `chromium.executablePath()` takes no channel argument and returns the _bundled_ Chromium path even for a channel that does not exist — so the probe is a real headless launch, closed immediately: ~500ms for an installed browser, milliseconds for a missing one, which rejects naming the path it looked at.

A **success is cached for the life of the process** (re-probing per launch would cost ~0.7–1.2s each time); a **failure never is**, so `GET /prereqs/browser` stays idempotent and the install-a-browser-then-re-check flow works without a restart.

An installed Chromium-family browser is a hard prerequisite of every row above — without one the plain profile falls back to a bundled Chromium that Entra SSO tends to flag (and that a packaged install does not ship at all), and zoom capture is impossible. It gates the whole download surface and none of the pipeline, which is why `/prereqs/browser` reports it to the settings screen.

See `ZOOM.md` for why the zoom profile is shaped this way.
