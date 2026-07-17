# Zoom recording capture

Zoom cloud recordings (`zoom.us/rec/share/…` links found in course-section summaries) are passcode-gated and serve a direct `.mp4`, captured like `videostream`. The player is picky, so this is the only path on the heavyweight browser profile.

## Why the heavyweight browser (`zoomBrowser.js`)

Headless Chrome falls back to SwiftShader software rendering AND leaks a `HeadlessChrome` UA token — the recording player rejects both. The fix is headed **system Chrome (`channel:'chrome'`) under a managed Xvfb virtual display**: it keeps the hardware D3D12 GPU renderer (WSL's `/dev/dxg` is reached independent of the X display) AND a clean `Chrome` UA, with no visible window. puppeteer-extra **stealth** closes the deeper automation leaks Playwright's args miss.

Hard constraints (each is load-bearing):
- **Do NOT override the UA** — including stealth's `user-agent-override` evasion, which we delete at module load. A rewritten UA desyncs from Chrome's Sec-CH-UA Client-Hints and zoom flags the mismatch. Stealth is registered ONLY on playwright-extra's `chromium`, so plain launches stay stealth-free.
- **Do NOT add `--use-angle=vulkan`** — no HW Vulkan on this box, so it falls back to SwiftShader.
- **Headless is rejected** for the two reasons above.

## Xvfb lifecycle

Managed in-process via `node:child_process`, spawned lazily on the first zoom launch, reused across launches, killed by `stopXvfb()` on `closeAllSessions()` plus a `process.once('exit')` safety net.

- Display number is chosen **explicitly** (`findFreeDisplay`, stepping up from `:99`), NOT via `-displayfd`. On WSLg `/tmp/.X11-unix` is a read-only tmpfs, so Xvfb can't create the filesystem socket an auto-picked display needs; an explicit `:N` makes it fall back to a Linux abstract Unix socket. `/tmp/.X{N}-lock` disambiguates a taken number.
- Readiness is polled by connecting to the abstract socket (`\0/tmp/.X11-unix/X{N}`); the `failed to bind listener` lines Xvfb prints for the impossible filesystem socket are harmless.
- A per-run XAUTHORITY (MIT-MAGIC-COOKIE) is handed to both Xvfb (`-auth`) and Chrome (env `XAUTHORITY`).
- The **node process is NOT wrapped in `xvfb-run`** — the headed Microsoft login browser must stay on the real WSLg display.

## Passcode gate

Every BIU share uses the single hardcoded `ZOOM_PASSWORD` (`config.js`) — not scraped per-link, not carried in the `ref`. Filled at the `#passcode` gate. The form is a Vue SPA whose reactive binding lands a beat after the input appears, so the fill+click is **retried up to 5×** until `#passcode` detaches (a fill fired too early is dropped and the gate never clears).

## Before/after-break split

One share link can hold two recordings (before/after the break). `captureVideo` returns **1-or-2** captures: it sniffs the second `.mp4` only when `.vjs-multiple-clip-control` reports "Total N Recordings" (N>1) and advancing via the "next clip" control yields a distinct stream. The caller (`core.js`) then splits the name into `<name>.1`/`<name>.2` (`splitName` in `naming.js`); a lone recording keeps the plain `<name>`.
