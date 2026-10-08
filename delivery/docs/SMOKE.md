# The release smoke suite

`smoke/` is `@playwright/test` driving the installed exe through `_electron`, run by `build.yml`'s
smoke job against the uploaded installer ([RELEASE.md](RELEASE.md#build-test-publish)). One ordered
file on one worker, since each check builds on the machine state the last one left: install, the
installed tree's DLL imports, boot, first run, the pipeline, a yt-dlp download, quit, the tools under a Hebrew temp
path, the browser chain, an in-place update. It needs an installed Windows build, so off the runner
only `npx playwright test --list` works — it is never "passed" from WSL.

## Rules

- **`resources/bin/` is one set with what the services probe** — compared exactly against the tool
  names `/health` reports minus `curl`, since a binary nothing spawns installs cleanly and shows up
  only as installer size.
- **No service boots reporting an unusable tool.** `/health`'s `tools` maps a usable tool to the
  bare string `ok` and an unusable one to `{state, params}`; the failure names each offender's
  `state` ([`lib/tools/CLAUDE.md`](../../lib/tools/CLAUDE.md)).
- **A clean machine, read statically.** Every installed `.exe`/`.dll`/`.pyd`/`.node` may import,
  normally or delay-loaded, only DLLs the install ships, API sets, or System32 DLLs that are not a
  VC++ redistributable — the runner has those, a user's PC may not. Runtime `LoadLibrary`/ctypes
  loads are not covered.
- **Offline, enforced by the OS.** Per-program outbound firewall rules block `FastStudy.exe`,
  `services.exe`, every exe under `resources/bin/` and the state root's yt-dlp copy — never an
  override variable in production code. The suite first proves a blocked program still reaches
  loopback and nothing else, so a wrong firewall assumption fails under its own name.
- **No provider is faked or reached.** The provider steps run and must fail on the network, which
  proves the frozen SDKs import and build a request. A fixed transcript and summary (`fixtures/`) go
  in through `database/`'s routes, so the PDF step runs for real.
- **Disk only through `database/`**, with the URLs and launch secret read off `window.faststudy`;
  the suite never spells the `DATA_ROOT` layout.
- **`data-testid`s only**, never visible text — the ids are a contract held by
  [`frontend/docs/ARCHITECTURE.md`](../../frontend/docs/ARCHITECTURE.md#smoke-suite-test-ids) and
  [`electron/docs/BOOT.md`](../../electron/docs/BOOT.md#the-launch-screen). A missing id is a
  follow-up for that consumer, never a text selector.
- **A yt-dlp download must merge.** `/download-url` fetches a loopback DASH manifest that offers the
  tone video only as separate video and audio streams, so `video.mp4` with both lands only if yt-dlp
  found the bundled ffmpeg. The state root's yt-dlp copy must exist first: it is what `toolPath` spawns.
  `AUTO_RUN` is `off` in-process, so the arrival queues nothing and its `launch.log` line proves it was reported.
- **The data folder is picked, never typed.** `data-root-input` is read-only, so first run stubs
  main's `dialog.showOpenDialog` with queued answers, clicks the real field, and restores it before
  leaving the wall; test 4 first proves a cancel keeps the launcher's default and each click opens one
  `openDirectory` dialog at the field's value.
- **First run confirms the privacy policy.** The wall's save opens it; Confirm must be disabled until
  `.privacy-body` is scrolled to its end, and confirming leaves error reports on for the rest of the
  run. The in-place update's previous release may predate the policy, so there it is answered only if shown.
- **One step at a time, through the backend.** A provider failure and a locked `summary.pdf` run
  alone via backend `run/{step}`, so the error is that step's. A provider's untranslated text must
  appear in `lecture-error-message` — the one text read — and its `step-status` reads `failed`; the
  lock is asserted by `/status`'s `file_locked` code and `file` param, since it carries no verbatim
  text. The lock is PowerShell holding the file with no sharing.
- **Live SSE is the audio step flipping pending → done** without a reload, never `running`, which a
  fast failure can skip.
- **An outcome, never a live process.** What Windows does asynchronously — a quit-time NSIS install,
  an update — is asserted by the durable state it leaves, since the action routinely finishes before
  the first poll. Forensics print the raw observed value even where the comparison normalizes it:
  rcedit stamps a four-component ProductVersion, and the `0.1.0.0` a tidied line would hide is what
  names the defect.
- **The launch secret is enforced**: every service answers 401 without it.
- **A Hebrew temp path is proven used.** The audio and PDF steps run with `TEMP` on a Hebrew folder,
  watched to prove each workspace landed there; the backend's line naming it must reach `launch.log`
  as UTF-8, not lost or `\u05..`-escaped.
- **The window is 1008x655 CSS px**, not the 1400x900 `electron/main.js` asks for — Windows clamps it
  to the runner's 1024x768 desktop (`"viewport"` in any `smoke-traces` launch trace). So a step touching
  a layout-dependent control works in both branches — test 8 clicks `lecture-actions-menu` only if present.
- **Launched with `--lang=en-US`**, so a failure screenshot is readable.

## Boot timing

Two boots are timed, never an extra launch: test 3's (the fresh install's first) and test 14's last
step (the candidate's first after the update). `lib/bootTiming.js` writes them to
`test-results/boot-timing.json` — `launch_to_app_ms` (`electron.launch` → main's `app loaded`
`launch.log` line, the launcher's own mark of `app://bundle` finishing its load; same machine, same
clock), `log_to_app_ms` (main's first `launch.log` line → that line) and each service's `ready_ms`
from that first line, plus version, commit and run ids. Numbers only, since it
becomes a public Release asset ([RELEASE.md](RELEASE.md#boot-timing)). Report only: no threshold, and a
value it cannot read is `null` with a warning, never a failure.

## Unproven until a Windows run

Each assumption only the runner can prove — the silent per-user install, Playwright attaching to the
packaged exe, the loopback exemption, a renamed browser dir reading as uninstalled, the blocked yt-dlp copy reaching a loopback server, an unsigned
update from a generic feed replacing `resources/` wholesale — fails with a message naming it.
