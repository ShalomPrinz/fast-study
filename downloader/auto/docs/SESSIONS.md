# Persistent browser sessions

The service holds long-lived browsers (the ~1–2s launch + context build is paid once), not one per
request. Model in `src/browser/browserSession.js`.

- **Per-profile DI.** `BrowserSession` takes an injected launcher and never hardcodes one.
  `getSession(profile)` lazily builds one browser+context+page per profile, each with its own idle
  timer; an extractor's `browserProfile` picks the profile (`'plain'` default, `ZoomExtractor` →
  `'zoom'`).
- **No cookies are injected.** The `'plain'` profile authenticates on demand via Moodle autologin
  ([AUTH.md](AUTH.md)); the `'zoom'` profile is passcode-gated, never BIU-auth.
- **`withLock(fn)`** serializes only the quick navigate+sniff, so one call's navigation can't abort
  another's; the heavy download runs afterward in `server/`, so downloads still overlap. `open()` is
  deliberately outside the lock — a no-op once open, and a shared lock risks deadlock.
- **Idle timeout** (~45 min) is a leak-safety valve only; a session re-opens lazily. Switching course
  is just `goto()`. `closeAllSessions()` (on `/close` and `SIGINT`/`SIGTERM`) closes every session and
  stops the managed Xvfb.

## Launch matrix

| Profile / path                                           | Browser                                                              | Display                                    | Visible            |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ | ------------------ |
| `'plain'` — videostream sniff (`browser/browserLaunch.js`) | resolved channel → bundled Chromium on launch failure, no stealth  | none (headless)                            | no                 |
| `'zoom'` — `ZoomExtractor` (`browser/zoomBrowser.js`)    | resolved channel + stealth, `headless:false`, no fallback            | Xvfb (Linux) / off-screen window (Windows) | no                 |
| Token grab (`MoodleToken.connect()`)                     | resolved channel → bundled Chromium on launch failure                | real desktop                               | **yes — MFA once** |

Every launch passes `--mute-audio`: recordings autoplay, and nobody is watching.

## Which browser (`browser/browserChannel.js`)

Both launchers build their own options — only the zoom one is forbidden a bundled-Chromium fallback
([ZOOM.md](ZOOM.md)) — but share one answer to "which browser": `resolveBrowserChannel()` tries
`channel:'chrome'`, then `'msedge'`, and returns the first that launches as `{ channel, browser }`.

Playwright has no public API that resolves a channel's executable — `chromium.executablePath()` takes
no channel and returns the _bundled_ path even for a channel that doesn't exist — so the probe is a
real headless launch, closed at once: ~500ms when installed, milliseconds when missing.

A **success is cached for the process** (re-probing per launch would cost ~0.7–1.2s); a **failure
never is**, so `GET /prereqs/browser` (always 200 — "no browser" is an answer) can be re-run after the
user installs one with no restart. An installed Chrome or Edge is a hard prerequisite: the bundled
Chromium fallback is what Entra SSO tends to flag and a packaged install doesn't ship at all, and zoom
is impossible without one. It gates the download surface and none of the pipeline.
