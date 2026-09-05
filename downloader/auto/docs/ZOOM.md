# Zoom recording capture

Zoom cloud recordings (`zoom.us/rec/share/…` links found in course-section summaries) are passcode-gated and serve a direct `.mp4`, captured like `videostream`. The player is picky, so this is the only path on the heavyweight browser profile.

## Why the heavyweight browser (`browser/zoomBrowser.js`)

Headless Chrome falls back to SwiftShader software rendering AND leaks a `HeadlessChrome` UA token — the recording player rejects both. The fix is **headed system Chrome (`channel:'chrome'`), hidden rather than headless**: it keeps the hardware GPU renderer AND a clean `Chrome` UA. puppeteer-extra **stealth** closes the deeper automation leaks Playwright's args miss. How the window is hidden is the one platform-dependent part (below).

Hard constraints (each is load-bearing):

- **Do NOT override the UA** — including stealth's `user-agent-override` evasion, which we delete at module load. A rewritten UA desyncs from Chrome's Sec-CH-UA Client-Hints and zoom flags the mismatch. Stealth is registered ONLY on playwright-extra's `chromium`, so plain launches stay stealth-free.
- **Do NOT add `--use-angle=vulkan`** — no HW Vulkan on this box, so it falls back to SwiftShader.
- **Headless is rejected** for the two reasons above.

## Hiding the window

`launchZoomBrowser()` branches on `process.platform`; everything else about the launch is identical on both.

**Windows** — no Xvfb exists, so the window is parked off-screen with `--window-position=-32000,-32000`. Without it a batch of N lectures steals focus N times. `FASTSTUDY_ZOOM_VISIBLE=1` drops the arg to watch a capture happen.

**Linux** — a managed Xvfb virtual display, which also keeps the hardware D3D12 renderer under WSL (`/dev/dxg` is reached independent of the X display). Managed in-process via `node:child_process`, spawned lazily on the first zoom launch, reused across launches, killed by `stopXvfb()` on `closeAllSessions()` plus a `process.once('exit')` safety net (both no-ops on Windows).

- Display number is chosen **explicitly** (`findFreeDisplay`, stepping up from `:99`), NOT via `-displayfd`. On WSLg `/tmp/.X11-unix` is a read-only tmpfs, so Xvfb can't create the filesystem socket an auto-picked display needs; an explicit `:N` makes it fall back to a Linux abstract Unix socket. `/tmp/.X{N}-lock` disambiguates a taken number.
- Readiness is polled by connecting to the abstract socket (`\0/tmp/.X11-unix/X{N}`); the `failed to bind listener` lines Xvfb prints for the impossible filesystem socket are harmless.
- A per-run XAUTHORITY (MIT-MAGIC-COOKIE) is handed to both Xvfb (`-auth`) and Chrome (env `XAUTHORITY`).
- The **node process is NOT wrapped in `xvfb-run`** — the headed token-grab browser must stay on the real WSLg display.

## Passcode gate

Passcodes are stored per course, with an optional per-lecture override, in `auth/zoom-passcodes.json` under the state root (`lib/passcodes.js`; plaintext, gitignored, like the session cookies) — not scraped per-link, not carried in the `ref`. `/resolve`'s zoom branch resolves it via `passcodes.lookup(course, name)` (lecture override wins, else course default) and threads it through `resolveRecording → captureVideo → #submitPasscode`. The frontend saves one via `POST /zoom/passcode`.

Filled at the `#passcode` gate. The form is a Vue SPA whose reactive binding lands a beat after the input appears, so the fill+click is **retried up to 5×** until `#passcode` detaches (a fill fired too early is dropped and the gate never clears). The gate throws `PasscodeError` → the HTTP layer replies **409 `{status:'passcode', reason, course, name}`**: `reason:'missing'` (gate present, none stored — thrown up front, no empty submits) or `reason:'incorrect'` (a stored passcode that never clears after the 5 retries). No gate = already authorized, a no-op.

## Before/after-break split

One share link can hold two recordings (before/after the break). `captureVideo` returns **1-or-2** captures: it sniffs the second `.mp4` only when `.vjs-multiple-clip-control` reports "Total N Recordings" (N>1) and advancing via the "next clip" control yields a distinct stream. The caller (`core/core.js`) then splits the name into `<name>.1`/`<name>.2` (`splitName` in `lib/naming.js`); a lone recording keeps the plain `<name>`.
