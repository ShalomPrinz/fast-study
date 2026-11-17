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
- **Idle timeout** (10 min): an idle parked Chrome costs real memory and CPU, and 10 min still spans the gaps between rows of a batch; a session re-opens lazily. It is paused while a `withLock` op runs and re-armed when it ends, so it never closes a browser mid-capture (a captcha solve included). Switching course
  is just `goto()`. `closeAllSessions()` (on `/close` and `SIGINT`/`SIGTERM`) closes every session and
  stops the managed Xvfb.

## Launch matrix

| Profile / path                                           | Browser                                                              | Display                                    | Visible            |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ | ------------------ |
| `'zoom'` — `ZoomExtractor` (`browser/zoomBrowser.js`)    | resolved channel + stealth, `headless:false`, no fallback            | Xvfb (Linux) / off-screen window (Windows) / app hidden by pid (macOS) | only on a captcha, Windows and macOS ([ZOOM.md](ZOOM.md#captcha-browserzoomcaptchajs)) |
| Token grab (`MoodleToken.connect()`, `browser/browserLaunch.js`) | resolved channel → bundled Chromium on launch failure, no stealth | real desktop                               | **yes — MFA once** |
| Challenge window (`moodle/challenge.js`)                 | resolved channel, persistent profile `moodle-profile` under the state root, UA = the probe's + ` MoodleMobile`; no installed channel (no UA) → no launch; bundled Chromium only when the probe worked and the channel's persistent launch failed, still with that UA | real desktop, launched off-screen; opened by a wall | only on a captcha ([MOODLE.md](MOODLE.md#the-rest-api)) |

Every launch passes `--mute-audio`: recordings autoplay, and nobody is watching.

`playwright`, `playwright-extra` and the stealth plugin load by dynamic `import()` on first browser
use, never at startup: they are over a second of auto's boot, more on Windows where Defender scans each file.
`POST /warmup` starts those loads without awaiting them; the launcher calls it once every service is healthy, so the user's first browser action skips the load.

## Off the taskbar (Windows) (`browser/windowStyle.js`)

Parked at `-32000` alone, the challenge window and the zoom browser still show on the taskbar and in
Alt+Tab; closing either breaks the call that owns it. Chrome has no flag for that, so on Windows the
window gets the Win32 **tool-window style** from outside: `WS_EX_TOOLWINDOW (0x80)` set and
`WS_EX_APPWINDOW (0x40000)` cleared in `GWL_EXSTYLE`, then `ShowWindow(SW_HIDE)` and
`ShowWindow(SW_SHOWNOACTIVATE)` so the shell rereads it. Plain `SW_HIDE` is rejected: `context.newPage()` showed the
window again, still on the taskbar, and a CDP raise could not bring a hidden window back
([Run 4](MOODLE.md#bot-protection-what-was-learned)).

- **Finding the window.** Both launches carry `--faststudy-window=<challenge|zoom>` (`windowMarker`; Chrome ignores unknown switches, and Playwright gives zoom a random profile, so a profile dir would not work). The script takes the `chrome.exe`/`msedge.exe` PIDs whose command line holds it, then their **visible, titled, unowned `Chrome_WidgetWin_1`** top-level windows; Chrome's invisible helper windows of that class must be left alone. It prints `{windows, exstyle}`, exits 3 with no window, and never prints a command line.
- **The styler.** `windowStyler(name)` → `{ hide(), show() }` (hide = tool style on, show = off), one per browser instance since a relaunched window is unstyled. One change runs at a time; calls made meanwhile collapse to the latest state; the promise never rejects. A failed run (non-zero exit, 15 s timeout) counts as applied and logs one `[window]` line per styler. Off Windows both resolve at once.
- **Order.** The clear is awaited before any move on screen, so a captcha window has its taskbar button and Alt+Tab entry and a user who clicks away can find it. The first show and `POST /window/show` run one sequence, on screen, minimize, restore, then `bringToFront`: Windows' foreground lock leaves a bare `bringToFront` behind the user's app, and the minimize and restore gets past it; the re-apply after parking is fire-and-forget, because `wsClient.js` awaits `passed()` on the call path. The challenge window styles right after launch, in parallel with `land()`; zoom styles in `BrowserSession`'s `opened` hook, kept in `zoomCaptcha.js`.
- **One `powershell.exe` spawn per change** (absolute `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, bypassing `toolPath` and `/tools` like `reg.exe`; inline script via `-EncodedCommand`). Under 1 s from Node: PowerShell start ~400 ms, CIM lookup ~150 ms, Win32 calls ~30 ms. Changes are rare (about three per block episode). A long-lived PowerShell (a resident process, a stdin protocol, a new orphan kind) and a native FFI module such as koffi (installer size, staging, smoke's DLL-import check) were rejected.
- **No C# compile.** The script defines its P/Invokes in memory (`DefinePInvokeMethod`) and walks windows with `FindWindowExW`, because `Add-Type`'s compile writes into `%TEMP%` and fails on a Hebrew path under PS 5.1; nothing else in it writes to TEMP.
- **`NO_WINDOW` (`windowsHide`) is mandatory.** Packaged, auto runs inside the GUI-subsystem `FastStudy.exe`, so a bare spawn opens a console window, the very thing this removes; dev runs under console `node.exe`, where it never shows.
- **Best-effort, no error code:** a failure is logged and never fails a call, like `_bounds`.
- **Known gaps.**
  - A 1-2 s taskbar blip per launch (the button appears when Chrome creates the window, whatever is awaited); `window.open` popups start on screen at 0,0 unstyled; the first show runs the raise's minimize and restore (see Order), since a bare `bringToFront` missed the foreground live ([Run 5](MOODLE.md#bot-protection-what-was-learned)); a small sample, so `POST /window/show` stays the user's way forward.
  - **A taskbar button can outlive the style.** Alt+Tab was correct at every step and `0x80` applied every time, but the shell does not always drop the button. A fresh launch can keep its button until the next captcha (the zoom window kept it about 3 minutes), and a closed challenge window's button (`Appid: Chrome.moodleprofile.Default`) can stay with no process behind it. It went away at the next clear-and-reapply of another parked window (in the live run, the zoom window's captcha cycle). Cause unknown. Live run 2026-11-06, Chrome 157.0.8103.38, Windows 11 26200: the first three launches lost the button within ~250 ms of the style; from the fourth on it stayed.

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
