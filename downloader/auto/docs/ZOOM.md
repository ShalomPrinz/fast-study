# Zoom recording capture

Zoom cloud recordings (`zoom.us/rec/share/…` links in course-section summaries) are passcode-gated
and serve a direct `.mp4`, sniffed from the player's request in a browser — the only strategy that
still captures. The player is picky, so it runs on the heavyweight `'zoom'` profile.

## Why the heavyweight browser (`browser/zoomBrowser.js`)

Headless Chromium falls back to SwiftShader software rendering AND leaks a `HeadlessChrome` UA
token; the player rejects both. So it is **a headed browser the user has installed, hidden rather
than headless** — hardware GPU renderer and the browser's own clean UA — chosen by
`browser/browserChannel.js` (Chrome, then Edge). puppeteer-extra **stealth** closes the deeper
automation leaks Playwright's args miss.

**Chrome and Edge are both proven** against a real share: gate cleared, both `.mp4` streams sniffed,
the next-clip advance yielding a distinct second clip, and `navigator.webdriver: false` with a
hardware renderer on each. Edge's own `Edg/…` token is fine — the constraint below is about a
_rewritten_ UA. Edge launches in ~1.2s against Chrome's ~0.7s.

Hard constraints, each load-bearing:

- **Do NOT override the UA** — including stealth's `user-agent-override` evasion, deleted when
  stealth is loaded on first use (`/warmup` or a zoom launch). A rewritten UA desyncs from the browser's Sec-CH-UA Client-Hints and zoom flags the
  mismatch. Stealth is registered only on playwright-extra's `chromium`, so plain launches stay clean.
- **Do NOT add `--use-angle=vulkan`** — no hardware Vulkan here, so it falls back to SwiftShader.
- **No bundled-Chromium fallback**, unlike the plain launcher: Playwright's Chromium is untested
  against the player (a `Chromium` UA, no proprietary codecs) and a packaged install ships none.

## Hiding the window

The one platform-dependent part of `launchZoomBrowser()`.

**Windows** — no Xvfb, so the window is parked off-screen (`--window-position=-32000,-32000`);
otherwise a batch of N lectures steals focus N times. `FASTSTUDY_ZOOM_VISIBLE=1` keeps it on-screen.
It comes on screen only for a captcha ([below](#captcha-browserzoomcaptchajs)).

**Linux** — a managed Xvfb virtual display, which under WSL also keeps the hardware D3D12 renderer
(`/dev/dxg` is reached independent of the X display). Spawned lazily on the first zoom launch,
reused, and killed by `stopXvfb()` on `closeAllSessions()` plus a `process.once('exit')` safety net.

- The display number is picked **explicitly** (`findFreeDisplay`, up from `:99`), never via
  `-displayfd`: on WSLg `/tmp/.X11-unix` is a read-only tmpfs, so Xvfb can't create the filesystem
  socket an auto-picked display needs; an explicit `:N` falls back to an abstract Unix socket.
- Readiness is polled on that abstract socket (`\0/tmp/.X11-unix/X{N}`); Xvfb's `failed to bind
  listener` lines for the impossible filesystem socket are harmless.
- A per-run XAUTHORITY cookie goes to both Xvfb (`-auth`) and the browser (env `XAUTHORITY`).
- The node process is **not** wrapped in `xvfb-run` — the headed token grab must stay on the real
  WSLg display.

## Captcha (`browser/zoomCaptcha.js`)

Zoom shows the passcode gate either way, so only the player says the way is clear. Once the gate
is cleared (or from load when there is none), a visible reCAPTCHA (bar v3's invisible badge),
hCaptcha or Cloudflare Turnstile frame — or no player (`video, .video-js`) within 30s — counts as
a captcha. No zoom-specific selector is known, so the check is generic. Every alternative carries
`:visible`, because Playwright checks only a selector list's first DOM match and reCAPTCHA keeps a
hidden challenge frame in the page.

A gate that outlasts its 2 attempts under a visible captcha frame is a captcha, not
`incorrect`: the frame swallows the clicks, and a wrong code is not the cause.

A share with no player and no captcha frame (expired, deleted, sign-in only — or a captcha the
check cannot recognise) takes the same path on Windows, so the user can look and act; closing the
window gives up early.

- **Windows** — the parked window moves on screen and to the front, as the Moodle challenge window
  does (CDP `Browser.setWindowBounds`), and `/auth/events` carries `zoomCaptcha: true` so the
  frontend can tell the user. Solved means the player is visible with no captcha frame left; a
  gate that shows with no frame over it (a captcha solved in front of it) takes the stored passcode
  again. The window then goes back off-screen (unless `FASTSTUDY_ZOOM_VISIBLE=1`), `zoomCaptcha`
  reads false, and the capture carries on; its `/resolve` 200 carries `captchaSolved: true`, on that
  one answer only, so a resolve queued behind the wait never claims it. Unsolved after 10 minutes
  is `503 zoom_captcha_timeout {url}`; a window the user closes is `zoom_browser_closed`.
  `zoomCaptcha` clears however it ends.
- **Linux** — Xvfb has no screen to show it on, so a visible captcha frame answers `503
  zoom_captcha_unsupported {url}` at once, and no player answers `zoom_no_media_request {url}`.

The 30s `.mp4` sniff is armed before `goto`, so a solve that outlasts it gets a second sniff armed
when the captcha is detected, cut to 30s once the solve ends: an autoplay right after the solve is
never missed. The zoom session's `withLock` stays held through the solve, so other zoom resolves queue.

## Passcode gate

Passcodes are stored per course, with an optional per-lecture override, in
`auth/zoom-passcodes.json` under the state root (`lib/passcodes.js`, plaintext) — never scraped per
link, never carried in the `ref`. `/resolve` looks one up (lecture override wins) and threads it to
the gate; the frontend saves one via `POST /zoom/passcode`.

The form is a Vue SPA whose binding lands a beat after the input appears, so a fill fired too early
is dropped: fill+click is **tried up to 2×** until `#passcode` detaches. The gate throws
`PasscodeError` → `409` `zoom_passcode_required {reason, course, name}`: `reason:'missing'` up front
when none is stored (no empty submits), or `'incorrect'` when a stored one never clears. The gate knows
neither course nor lecture, so the route fills those two in. No gate means already authorized.

## Before/after-break split

One share can hold two recordings. `captureVideo` sniffs a second `.mp4` only when
`.vjs-multiple-clip-control` reports "Total N Recordings" (N>1) and the next-clip control yields a
distinct stream. `core/core.js` then names them `<name>.1`/`<name>.2` (`lib/naming.js`); a lone
recording keeps `<name>`.
