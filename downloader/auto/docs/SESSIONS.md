# Persistent browser sessions

The service holds long-lived browsers (the ~1–2s launch + context build is paid once), not one per
request. Model in `src/browser/browserSession.js`.

- **Per-profile DI.** `BrowserSession` takes an injected launcher and never hardcodes one.
  `getSession(profile)` lazily builds one browser+context+page per profile, each with its own idle
  timer; an extractor's `browserProfile` picks the profile, and only `ZoomExtractor` has one
  (`'zoom'`). No session holds a Moodle login: the `'zoom'` profile is passcode-gated, and Moodle is
  reached over the WS API ([MOODLE.md](MOODLE.md#videostream)).
- **`withLock(fn)`** serializes only the quick navigate+sniff, so one call's navigation can't abort
  another's; the heavy download runs afterward in `server/`, so downloads still overlap. `/resolve`
  calls `open()` inside its locked op, so a browser closed while an earlier call held the lock is
  relaunched; `open()` takes no lock itself, and concurrent callers share one launch.
- **A user-closed window.** The browser's `disconnected` (or its page's `close`) drops the session, so
  the next `open()` launches a fresh browser. A capture cut off mid-way — Playwright's
  `TargetClosedError`, its plain-Error `Target page, context or browser has been closed` (wording in `browserSession.js`), or any failure once the page is closed — answers `503 zoom_browser_closed
  {detail}` with no `status`, a handled refusal that never reaches the backstop or Sentry.
- **Idle timeout** (~45 min) is a leak-safety valve only; a session re-opens lazily. It is paused while a `withLock` op runs and re-armed when it ends, so it never closes a browser mid-capture. Switching course
  is just `goto()`. `closeAllSessions()` (on `/close` and `SIGINT`/`SIGTERM`) closes every session and
  stops the managed Xvfb.

## Launch matrix

| Profile / path                                           | Browser                                                              | Display                                    | Visible            |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ | ------------------ |
| `'zoom'` — `ZoomExtractor` (`browser/zoomBrowser.js`)    | resolved channel + stealth, `headless:false`, no fallback            | Xvfb (Linux) / off-screen window (Windows) | only on a captcha, Windows ([ZOOM.md](ZOOM.md#captcha-browserzoomcaptchajs)) |
| Token grab (`MoodleToken.connect()`, `browser/browserLaunch.js`) | resolved channel → bundled Chromium on launch failure, no stealth | real desktop                               | **yes — MFA once** |
| Challenge window (`moodle/challenge.js`)                 | resolved channel, persistent profile `moodle-profile` under the state root, UA = the probe's + ` MoodleMobile`; no installed channel (no UA) → no launch; bundled Chromium only when the probe worked and the channel's persistent launch failed, still with that UA | real desktop, launched off-screen; opened by a wall | only on a captcha ([MOODLE.md](MOODLE.md#the-rest-api)) |

Every launch passes `--mute-audio`: recordings autoplay, and nobody is watching.

`playwright`, `playwright-extra` and the stealth plugin load by dynamic `import()` on first browser
use, never at startup: they are over a second of auto's boot, more on Windows where Defender scans each file.
`POST /warmup` starts those loads without awaiting them; the launcher calls it once every service is healthy, so the user's first browser action skips the load.

## Which browser (`browser/browserChannel.js`)

Both launchers build their own options — only the zoom one is forbidden a bundled-Chromium fallback
([ZOOM.md](ZOOM.md)) — but share one answer to "which browser": `resolveBrowserChannel()` tries
`channel:'chrome'`, then `'msedge'`, and returns the first that launches as `{ channel, browser, userAgent }`.
`userAgent` is read off a page in the same headless launch with `HeadlessChrome` → `Chrome` — the UA a
headed launch sends, which the challenge window extends ([MOODLE.md](MOODLE.md#the-rest-api)) — or
null when the page could not report it. A null UA is not cached: `resolveUserAgent()` re-probes the
resolved channel for it on each ask, leaving the cached channel alone.

Playwright has no public API that resolves a channel's executable — `chromium.executablePath()` takes
no channel and returns the _bundled_ path even for a channel that doesn't exist — so the probe is a
real headless launch, closed at once: ~500ms when installed, milliseconds when missing. Without a prior
`/warmup`, the first probe also pays Playwright's load (~1s), so the first `GET /prereqs/browser` takes ~1.5s.

A **success is cached for the process** (re-probing per launch would cost ~0.7–1.2s); a **failure
never is**, so `GET /prereqs/browser` (always 200 — "no browser" is an answer) can be re-run after the
user installs one with no restart. An installed Chrome or Edge is a hard prerequisite: the bundled
Chromium fallback is what Entra SSO tends to flag and a packaged install doesn't ship at all, and zoom
is impossible without one. It gates the download surface and none of the pipeline.
