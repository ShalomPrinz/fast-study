# The release smoke suite

`smoke/` is `@playwright/test` driving the installed exe through `_electron`, run by `smoke-suite-win.yml`
against the uploaded installer — as `build.yml`'s `smoke-win` job, or by `smoke.yml` against an earlier run's
([RELEASE.md](RELEASE.md#build-test-publish)). One ordered
file on one worker, since each check builds on the machine state the last one left: install, the
installed tree's DLL imports, boot, first run, the pipeline, the open-PDF control, drive off, a yt-dlp download, a manual file import by path, quit, a launcher crash, a backend death and restart, the tools under a Hebrew temp
path, the browser chain, an in-place update. It needs an installed Windows build, so off the runner
only `npx playwright test --list` works — it is never "passed" from WSL.

`release.spec.js` is the one file Playwright loads: it holds the serial mode, the hooks and the 17
`test()` lines in order, each given the body `tests/NN-<name>.js` exports. What two or more tests
share lives in `lib/` — the running app in `lib/session.js`, whose `session` and `services` importers
read as live bindings and only its own functions reassign; a helper or constant one test uses stays
in that test's file. Shared bodies and `lib/` modules reach OS primitives only through `lib/platform.js`,
which re-exports `lib/windows.js` or `lib/mac.js` by host under the same names; a name the macOS side
has not implemented throws "not implemented on macOS".

## Scope

The suite asks one question: did build, freeze, stage and install produce the app the source tests
proved? It never asserts flow behaviour — UI wording, step order, how an error code renders — which
the app-harness E2E specs own ([`.claude/harness/README.md`](../../.claude/harness/README.md)); a step
status, an error code or a provider's verbatim text (test 5's `lecture-error-message`) is read only as
evidence of a packaging fact. Flow checks stay here only because no harness spec covers them yet,
two in `lib/firstRun.js`: the privacy gate — the wall's first save opens the policy, and Confirm stays
disabled until `.privacy-body` is scrolled to its end (test 4, and test 17 when the policy opens) — and a canceled folder dialog
keeping the launcher's default (test 4). A third, the manual import (test 11, macOS 14), holds the Downloads → Manual → File from computer flow too, since the harness has no Electron and so no bridge path or Move; the same is true of the zoom test below. The boundary is the
root [`CLAUDE.md`](../../CLAUDE.md#test-boundaries)'s test boundaries.

| Test                    | The failure only packaging can cause                                                                                                 | Harness flow side                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 1. fresh install        | the per-user NSIS install fails, `resources/` drifts from `BOOT.md`'s tree, the shipped extension's version is not the recorded `extension-version.txt`, the shipped native host breaks | —                                                  |
| 2. DLL imports          | an installed binary imports a DLL a clean PC lacks                                                                                   | —                                                  |
| 3. boot                 | the launcher spawns out of order, a bundled tool is unusable, `bin/` and the probed tools differ, a service runs without the secret, a frozen native library (pdfium, Pillow's `_imaging`) fails to load at import | —                                                  |
| 4. first run            | main's native folder dialog over IPC breaks, keys land in `settings.json` unencrypted, a probe reaches the network instead of `unverified` | `first-run-and-data-folder.spec.mjs`               |
| 5. provider steps       | the bundled ffmpeg is not spawned by path; a frozen SDK fails to import or build a request, rather than failing on the network       | `failure-surfacing.spec.mjs`                       |
| 6. the PDF              | bundled pandoc or tectonic fails, the shipped `.fmt` is rebuilt rather than reused, Hebrew glyphs drop, a PDF or PNG summary figure misses the shipped cache or its filter | `recitation-pipeline.spec.mjs`, `summary-figures.spec.mjs` |
| 7. live SSE             | SSE never reaches the document under `app://bundle` with the launch secret, so the page needs a reload                              | `recitation-pipeline.spec.mjs`                     |
| 8. drive off            | a fresh install's defaults run a step past the PDF or upload to Drive                                                                | —                                                  |
| 9. opening a PDF        | `open-pdf` fails through the preload bridge and `shell.openPath`; a real Windows exclusive handle is not reported as `file_locked`   | `locked-file.spec.mjs`                             |
| 10. yt-dlp download     | yt-dlp cannot find the bundled ffmpeg to merge DASH, the state root's yt-dlp copy is not seeded, `/video-arrived` is never reported  | `download-all.spec.mjs`                            |
| 11. manual import by path | the packaged sandboxed preload's `webUtils.getPathForFile` gives no path for a chosen file (Move stays disabled), the frozen database's import route fails, or its cross-volume Move does not copy then unlink: Copy keeps the source, Move on the data root's volume and Move from the runner's other drive remove it, each leaving a `video.mp4` of the source's size and hash; the Copy and the cross-volume Move use Hebrew source names (the Move a Hebrew lecture name too), so a Hebrew path that does not survive `getPathForFile`, JSON and the frozen database also fails here | `manual-file-import.spec.mjs` (plain-browser upload only) |
| 12. quit, no orphans    | a frozen process or port outlives the launcher's teardown; settings do not persist across a relaunch                                 | —                                                  |
| 13. launcher crash      | a `taskkill /F` of main alone (no `/T`) leaves a frozen service, a Node service, or an `ffmpeg`/`pandoc`/`tectonic` the backend's job holds running | —                                                  |
| 14. backend death       | the frozen backend's ctypes Job Object call fails on real Windows, so a killed backend leaves its `ffmpeg` running; a tool or service outlives the restart's teardown, an old port is held by anything but a new service, the reboot runs other than four service processes, `bridge.json` keeps the old `server` port | `service-banner.spec.mjs`                          |
| 15. Hebrew temp path    | a bundled tool breaks under a non-ASCII `TEMP`; the frozen services do not write UTF-8 to `launch.log`                               | —                                                  |
| 16. the browser chain   | the prerequisite misresolves installed Chrome or Edge; the PDF step depends on a browser                                             | —                                                  |
| 17. an in-place update  | the updater fails to replace `resources/` from a feed, or loses the keys, the yt-dlp copy or the new `.fmt`                          | —                                                  |

A new smoke test adds its row here, its file under `tests/` and its line in `release.spec.js`; a test with no packaging-only failure belongs in the harness or a unit test.

## Rules

- **`resources/bin/` is one set with what the services probe** — compared exactly against the tool
  names `GET /tools` reports minus `curl`, since a binary nothing spawns installs cleanly and shows up
  only as installer size.
- **No service boots reporting an unusable tool.** Each service's secret-guarded `GET /tools` (all
  but `database/`) answers once its boot probe settles, mapping a usable tool to the bare string
  `ok` and an unusable one to `{code, state, params}`; the failure names each offender's `code` and
  `state` ([`lib/tools/CLAUDE.md`](../../lib/tools/CLAUDE.md)).
- **A clean machine, read statically.** Every installed `.exe`/`.dll`/`.pyd`/`.node` may import,
  normally or delay-loaded, only DLLs the install ships, API sets, or System32 DLLs that are not a
  VC++ redistributable — the runner has those, a user's PC may not. Runtime `LoadLibrary`/ctypes
  loads are not covered.
- **Offline, enforced by the OS.** Per-program outbound firewall rules block `FastStudy.exe`,
  `faststudy-services.exe`, every exe under `resources/bin/` and the state root's yt-dlp copy — never an
  override variable in production code. The suite first proves a blocked program still reaches
  loopback and nothing else, so a wrong firewall assumption fails under its own name.
- **No provider is faked or reached.** The provider steps run and must fail on the network, which
  proves the frozen SDKs import and build a request. A fixed transcript and summary (`fixtures/`) go
  in through `database/`'s routes, so the PDF step runs for real; test 6 also puts two figures
  (`fixtures/figures/`, a pdfium-cropped PDF and a PNG) and links them as the app does.
  Cropping itself runs only after a Gemini answer, so the frozen pdfium and Pillow are proven by
  boot's import alone, never by a render.
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
- **A kill lands mid-`ffmpeg`.** Tests 13 and 14 start the audio step on a six-hour tone and kill
  only once its `ffmpeg` runs under the backend; an `audio.mp3` afterwards means it ended first, which
  fails the check as vacuous. The job's tools seen before the kill, by pid and start time, must be
  gone within 5 s of it — before test 13 drops the app or test 14 restarts — since an orphan exits by
  itself once its encode ends; only the services get a 30 s teardown. Only `faststudy-services.exe`, the Node services and the backend job's
  tools are asserted — `yt-dlp`, `curl` and Chromium outliving a dead Node service is an accepted gap.
- **The launch secret is enforced**: every service answers 401 without it.
- **The native host answers without the app**: test 1 sends the shipped `bridge/host.js`, on
  `FastStudy.exe` as node, one framed `{}` with stdin left open and a missing bridge file, and expects
  `{ "running": false }` — what Chrome gets before the app has ever booted.
- **A Hebrew temp path is proven used.** The audio and PDF steps run with `TEMP` on a Hebrew folder,
  watched to prove each workspace landed there; the backend's line naming it must reach `launch.log`
  as UTF-8, not lost or `\u05..`-escaped.
- **The window is 1008x655 CSS px**, not the 1400x900 fallback it opens at (fresh userData has no saved
  size, see `electron/windowState.js`) — Windows clamps it to the runner's 1024x768 desktop (`"viewport"` in any `smoke-traces` launch trace). So a step touching
  a layout-dependent control works in both branches — test 9 clicks `lecture-actions-menu` only if present.
- **Launched with `--lang=en-US`**, so a failure screenshot is readable.
- **The first-run tour is pre-dismissed** by a context init script on every launch, so its overlay blocks no click; the tour is `tour.spec.mjs`'s.

## The macOS suite

`mac.spec.js`, run by `smoke-suite-mac.yml`'s `smoke-mac` job with `playwright.mac.config.js`, holds
21 tests on one worker, in order, each building on the state the last left. Mac-only bodies are in
`tests/mac/`; the rest of the Windows suite's bodies run here unchanged from `tests/`, either
directly (live SSE, drive off, quit, launcher crash, backend death) or wrapped by a `tests/mac/` file
that adds evidence (first run, provider steps, the PDF, open PDF, yt-dlp, Hebrew temp, browser chain).
The fresh install, boot, update and binary-linkage tests have a body per platform (linkage reads PE
on Windows, Mach-O here). `lib/paths.js` answers
the bundle's and the state root's macOS paths to the shared `lib/`. The suite sets up no firewall of
its own; the OS keeps it offline, below.

| Test | The failure it catches — only the macOS packaging can cause it, the zoom test aside |
| --- | --- |
| dmg install | the dmg does not mount or holds no `FastStudy.app`; a tool lost its exec bit; the bundle is another version; the run is not offline (its premise check, below) |
| signatures | the bundle's seal, or any Mach-O inside it, fails `codesign --verify`; a native one has no arm64 slice |
| boot | a service does not come up from the bundle; `GET /tools` reports a darwin tool unusable |
| ffmpeg | the source-built ffmpeg cannot run the audio step: `ffmpeg.py`'s prefix and `strip_audio.py`'s arguments, on a tone it encodes itself, must write an MP3 that reads back 16 kHz mono |
| native host | the Chrome manifest the running app registered names a script that does not answer one framed `{}` with the live port, secret and extension version |
| zoom | the staged `auto`, run on the app binary as node, cannot open its real zoom session or reach `osascript`; the session's browser does not report `NSRunningApplication.hidden`, hides a second browser launched beside it, or does not come back on `show()` |
| first run | shared `tests/04-first-run.js`: the wall does not show, a key or the university probe reaches a provider offline instead of ending `unverified`, the folder dialog does not open at the launcher's default, or `safeStorage` (Keychain) stores a key in the clear or refuses it. Evidence is the wall, each probe's result and the stored field names |
| provider steps | shared `tests/05-provider-steps.js`: the audio step does not run for real, or a frozen SDK (Groq, Gemini) fails to import or build a request instead of failing on the network. Leaves the lecture the PDF test renders (audio.mp3 and the fixed transcript). Evidence is each step's code and detail and the files left |
| PDF | shared `tests/06-pdf.js`: Mac pandoc or tectonic fails, the primed cache's `.fmt` is rebuilt rather than reused, Hebrew glyphs drop, a PDF or PNG figure misses the cache or its filter (pdfium, Pillow). Evidence is the formats listing and the PDF text check |
| live SSE | shared `tests/07-live-sse.js`: the packaged SPA under `app://bundle` with the launch secret never receives `database/`'s SSE `/events` (frozen database or the secret query param), so the audio step does not flip pending to done in the same document. The lecture is its own, built from the bundled ffmpeg's tone, so the PDF lecture stays untouched |
| drive off | shared `tests/08-drive-off.js`: a fresh install's defaults run a step past the PDF or upload to Drive (a `drive_url.txt`, a Drive consent modal). It reads only the service API and `database/`'s routes, so it needs no Mac bundle path for the Google client JSON. It reuses the complete PDF lecture and changes no file in it |
| open PDF | the open-control half of shared `tests/09-open-pdf.js`: `open-pdf` fails through the preload bridge and `shell.openPath` (error toast), or Preview never ends up holding `summary.pdf`. LaunchServices starts Preview under launchd, so it is neither the app's child nor in `no_inet`, and hands the document over by Apple Event, not argv; the observation is `lsof -c Preview` listing the PDF's real path, which needs no TCC consent (`osascript`/System Events would). Preview is killed before and after. The Windows half, a `file_locked` for an exclusively held PDF, has no Mac counterpart: macOS holds no mandatory file locks. Evidence is the path and the PDFs Preview held |
| yt-dlp download | shared `tests/10-ytdlp-download.js`: yt-dlp does not merge the DASH fixture's streams, or the state root's yt-dlp copy is not seeded. Homebrew's ffmpeg is on this runner's PATH, so a merge alone does not show the bundled one ran: the process table sampled during the download must show yt-dlp handed `--ffmpeg-location` at `Contents/Resources/bin/ffmpeg` and no other ffmpeg running. Evidence is the arguments seen, the ffmpeg processes seen (sampled, may miss a short merge) and `video.mp4`'s size and stream dump |
| manual import | shared `tests/17-manual-import.js` through `tests/mac/16-manual-import.js`: as on Windows, with Move from another volume run from a temporary APFS disk image (`hdiutil create`/`attach -nobrowse` at a mountpoint, detached in `finally` and `afterAll`). The first source sits in `~/Downloads/faststudy-smoke-import`; the read is recorded as `read without a prompt`, `prompted` (no end within 45 s, desktop screenshot) or `refused` (the card's `data-code`) in the evidence file — evidence only, since a runner's TCC is not a user's Mac — and a prompted or refused Copy is retried from a neutral temp folder, which the Moves then use, so the Moves do not read from `~/Downloads`. The import route prepares its source off the database's event loop, so a read blocked on a TCC prompt times out that leg alone and the database keeps answering |
| quit | shared `tests/11-quit.js`: after the window closes, a process under the bundle or the state root, or a service port, outlives the app (the process group teardown of `electron/teardown.js`); a relaunch does not show the init wall again |
| backend death | shared `tests/13-backend-death.js`: a hard-killed backend leaves its ffmpeg running (main's group `SIGKILL` on a child's exit), or the restart does not reboot four services on fresh ports and rewrite `bridge.json` |
| Mach-O linkage | a Mach-O in the bundle (frozen Python, ffmpeg, pandoc, tectonic, Electron) has a load command or `LC_RPATH` that does not resolve inside the bundle or to `/usr/lib/`, `/System/` — a Homebrew link loads on this runner and nowhere else. Read in-process by `lib/linkage.js`; evidence is the count, link roots, rpaths and offender list |
| Hebrew temp | shared `tests/14-hebrew-temp.js`: a bundled tool (ffmpeg, pandoc, tectonic) or the frozen backend breaks under a non-ASCII `TMPDIR`, or the frozen services do not write UTF-8 to `launch.log`. The body also reads `TMPDIR` off the launcher's main process, so the offline `sudo -E` wrapper dropping or rewriting it fails the check. Evidence is the `TMPDIR` the app saw, each step's workspaces in it and the `launch.log` lines naming it |
| browser chain | shared `tests/15-browser-chain.js`: with `/Applications/Google Chrome.app` renamed aside (Playwright resolves a channel by that fixed path, not bundle id, so the rename is what the app sees) the prerequisite does not resolve Edge, or with both gone settings does not show the missing state and the install link, or the PDF step needs a browser. Both `.app`s are restored in `finally` and again in `afterAll`. The rename needs write on `/Applications` (the runner is an admin); the native-host leg stays with the native host test. Evidence is each leg's prerequisite status and channel |
| launcher crash | shared `tests/12-launcher-crash.js`: after `SIGKILL` of main, a service or a bundled ffmpeg/pandoc/tectonic outlives it. Strict: macOS has no job object, so the launcher spawns each service with a never-written stdin pipe and `FASTSTUDY_LIFELINE=1`; main's death closes the pipe and the service's `serve()` sees EOF and `SIGKILL`s its own process group, tools included; a failure skips only the update test |
| update | a lower-version build fed the candidate over loopback does not download it, carry its keys across the swap in memory, or install it only on Restart now or its next launch |

- **The zoom test also holds a flow check.** Hiding the zoom browser and `show()` are `downloader/auto`
  behaviour, kept here because no harness spec can cover them: the harness runs on Linux and
  `auto`'s unit tests fake the `osascript` call. Its packaging fact is the first clause alone.
- **The manual import test's legs.** Each picks the source with `setInputFiles` on `manual-file-input`, asserts
  `window.faststudy.pathForFile` (read in a capture-phase `change` listener, since the page clears the input)
  answers the source's real path and `manual-import-start[data-mode=move]` is enabled, starts Copy or Move, and follows
  `manual-import` to `done`. Sources are the tone video plus a 96 MiB `free` atom. The Copy source is named `הרצאה 5 - הקלטה.mp4` and the cross-volume Move's `העברה 7 - הקלטה.mp4` into lecture `הרצאה 7`; the same-volume Move stays ASCII, so a failure isolates to the name. A `setInputFiles` that chooses no file fails with a message naming that (Chromium under a C locale ignores a Hebrew path; Windows and macOS runners should not). Afterwards, through `database/`
  only: `video.mp4` has the source's size and sha256, a Copy leaves its source in place at its size, a Move removes it, and both
  report `data-original-kept=false` (it is true only when a Move could not delete its source). The same-volume legs also need the file's `dev` to equal the source's, the other-volume leg's to
  differ. Full-window screenshots (file chosen, running, done) land in `test-results/import-screenshots/`; the running one
  is best effort, since a local copy may end first. They ride the logs artifact on macOS, and `smoke-import-screenshots` on Windows
  with a run-summary listing, on success too. The macOS evidence file names them.
- **Another volume.** Windows: the first of `C:` to `H:` whose `dev` differs from the data root's (the runner's
  `RUNNER_TEMP` is on `D:`, the OS on `C:`). macOS: the disk image above.
- **Offline at the OS, by group.** `smoke-suite-mac.yml` creates group `no_inet` and loads a pf anchor,
  `block return out quick proto { tcp udp } from any to any group no_inet`, under a main ruleset
  that opens with `set skip on lo0`. Every suite-driven launch of the app, every `ELECTRON_RUN_AS_NODE` probe and
  the zoom probe runs through `sudo -u <runner> -g no_inet` (`lib/mac.js`'s `offlineArgv`; Playwright's
  `executablePath` is a generated script that bakes it in), so the services and tools inherit the
  gid while the runner's own traffic (checkout, uploads) stays staff. The dmg install test ends with the premise
  check, `lib/offline.js`: as the app, loopback answers and `https://github.com/` fails to connect
  (DNS still resolves, through `mDNSResponder`), while the runner reaches it. A GID, not a UID: a
  second user would leave the Aqua/WindowServer session a `BrowserWindow` needs. Not `sandbox-exec`:
  Seatbelt forbids a nested `sandbox_init`, which Chromium's own sandbox makes.
  The update test's relaunch stays offline: the old build runs under the wrapper, so its detached
  `/bin/sh` helper has the gid, and on a swap with a key handoff it execs `"$app/Contents/MacOS/$exe"`
  directly (`electron/macUpdate.js`). Only the `open "$app"` fallback (failed swap, no handoff) goes
  through launchd and runs online.
- **Process primitives on macOS.** `lib/mac.js` answers `processTable` from `ps -axww` (`comm` for the
  executable path, `lstart` as `created`, zombies dropped), `listeners` from `lsof -iTCP -sTCP:LISTEN`,
  and `strayProcesses` by executable path, never command line, since the root `sudo` parent names the
  bundle in its arguments. Under the offline `sudo` wrapper `app.process().pid` is sudo's, so the backend-death and
  launcher-crash tests find main as the four ready ports' owners' one parent; `forceKill` is a plain `SIGKILL` of that pid.
  The launcher-crash test runs just before the update, so its expected failure skips only that.
- **Evidence is written, not only asserted.** Each test appends what it observed to
  `test-results/mac-evidence.md` — the `codesign` output, `/tools`, the native host's reply with the
  secret masked, the zoom states, `update.log` — which the job puts in the run summary and uploads as
  `smoke-mac-logs` on success too. A failed test also screenshots the desktop, since what blocks a
  macOS boot is a system prompt no page shows.
- **The update is driven as a user's, twice.** The previous zip is unpacked into `/Applications`,
  its `app-update.yml` pointed at the feed and the bundle re-signed, all before its one launch, which
  stores two API keys through `window.faststudy.settings.write`. Scenario A runs Restart now over
  `window.faststudy.updates`; the quitting launch's `launch.log` is kept as it grows, because the
  new build truncates it. Scenario B quits the previous build plainly after the download, asserts the
  bundle is still the old version with no `update.log`, then starts the old binary directly (it quits
  before any window, so Playwright cannot drive it) and reads its `launch.log` as it appears. The
  helper starts the new build directly with the keys on fd 3, outside Playwright, so `launch.log` and
  `update.log` are all the test reads there.
- **Both scenarios assert the key handoff.** `update.log` reads `started <bundle>/Contents/MacOS/FastStudy
  with the handoff on fd 3`; the new build's `launch.log` reads `handoff: deleted 1 "FastStudy Safe
  Storage" Keychain item(s)` and `handoff: re-encrypted gemini_api_key, groq_api_key, token_key`, and
  never the token key's regeneration line. The candidate is then launched under Playwright, where both
  `…ApiKeySet` flags read true, and exactly one "FastStudy Safe Storage" item remains (counted from
  `security dump-keychain`, else by deleting it twice: the second exits 44). B adds the old build's
  `version <v> verified in <n>ms — installing it before this launch` and the new build's `pending
  update cleared`. The flags show a stored ciphertext, not a decrypt; `token_key` is re-encrypted, so
  it is not compared.
- **One verdict per scenario, in the evidence file.** `ADOPTED`, `KEYCHAIN-PROMPT` (the delete timed
  out on a prompt, which decides the fallback), `NOT-ADOPTED` (a `handoff not adopted`, `handoff
  unreadable` or `installing without a key handoff` line), `REGENERATED`, `UNAVAILABLE` (no key store),
  `HUNG` (the new build never loaded; also what a previous build older than the handoff gives, since
  its helper uses `open`) or `INCONCLUSIVE`. The line assertions fail on everything but `ADOPTED`.
  `build.yml` builds the previous version from the same checkout, so it carries the handoff.

## Re-running against an existing build

`gh workflow run smoke.yml --ref <ref> -f run-id=<build.yml run id>`, or Actions → "Smoke-test a
build" → "Run workflow", runs the suite at `<ref>` on that run's installers — valid only when the two
commits differ at most under `delivery/smoke/`, which its guard checks
([RELEASE.md](RELEASE.md#re-running-smoke)). GitHub lists a dispatch-only workflow, and accepts its
dispatch, only once the file is on the default branch.

## Boot timing

The Windows suite times two boots, never an extra launch: the boot test's (the fresh install's first)
and the update test's last step (the candidate's first after the update). The macOS suite times none. `lib/bootTiming.js` writes them to
`test-results/boot-timing.json` — `launch_to_app_ms` (`electron.launch` → main's `app loaded`
`launch.log` line, the launcher's own mark of `app://bundle` finishing its load; same machine, same
clock), `log_to_app_ms` (main's first `launch.log` line → that line) and each service's `ready_ms`
from that first line, plus version, commit and run ids. A `smoke.yml` run uploads none ([RELEASE.md](RELEASE.md#re-running-smoke)). Numbers only, since it
becomes a public Release asset ([RELEASE.md](RELEASE.md#boot-timing)). Report only: no threshold, and a
value it cannot read is `null` with a warning, never a failure.

## Unproven until a macOS run

That `webUtils.getPathForFile` answers a path for a file Playwright's `setInputFiles` set, in the packaged sandboxed preload (both OSes); that `hdiutil create`/`attach -nobrowse` mounts an APFS image with no prompt and the app may read it; that the app reading `~/Downloads` raises (or not) a Files-and-Folders prompt and what the import's error code then is (`import_source_unreadable` assumed); that `~/Downloads` and `RUNNER_TEMP` share a volume.

That `ps -o comm=` prints the full executable path (so `exe` matches `appExe()` and `toolPath()`), that
the frozen backend's ffmpeg is a direct child of the pid listening on its port, that `lsof` shows the
runner's listeners, that a service killed leaves main's group `SIGKILL` reaping its ffmpeg inside
five seconds, that Playwright's `app.close()` on a dead main under a root `sudo` returns, and that
the launcher-crash test fails today: `electron/docs/BOOT.md` says only a `SIGKILL` of main escapes teardown.

That pf's `group` match reads the socket owner's effective gid and the services and tools inherit the
`sudo -g` primary gid; that `block return` fails a connect fast; that sudo's `-E` and the drop-in
carry the app's environment and that a user cannot signal the root-owned `sudo` parent (quit goes
through the window; the hooks `pkill` the bundle), so a timed-out probe's group kill reaches the app only
because sudo without a pty keeps it in sudo's own process group; that the Playwright-launched app still gets its
Aqua session under sudo; Playwright's `_electron` driving the bundle's binary; the runner's default keychain being unlocked
for `safeStorage`; both Chrome and Edge in `/Applications` and a GUI session `NSRunningApplication` can
read; that App Management (TCC) lets the plain `runner` rename a signed third-party `.app` there, which the browser chain needs; `/Applications` being writable to the runner's user, which the updater's stage step requires.

## Unproven until a Windows run

That the runner has a second writable drive (`C:` and `D:` assumed, `dev` telling them apart) and `webUtils` answers a path for Playwright's `setInputFiles` in the packaged exe.

Each assumption only the runner can prove — the silent per-user install, Playwright attaching to the
packaged exe, the loopback exemption, a renamed browser dir reading as uninstalled, libuv's kill-on-close job taking main's services with it and the backend's own job taking its tools, the blocked yt-dlp copy reaching a loopback server, an unsigned
update from a generic feed replacing `resources/` wholesale — fails with a message naming it.
