# The release smoke suite

`smoke/` is `@playwright/test` driving the installed exe through `_electron`, run by `build.yml`'s
smoke job against the uploaded installer ([RELEASE.md](RELEASE.md#build-test-publish)). One ordered
file on one worker, since each check builds on the machine state the last one left: install, the
installed tree's DLL imports, boot, first run, the pipeline, a yt-dlp download, quit, the tools under a Hebrew temp
path, the browser chain, an in-place update. It needs an installed Windows build, so off the runner
only `npx playwright test --list` works — it is never "passed" from WSL.

## Scope

The suite asks one question: did build, freeze, stage and install produce the app the source tests
proved? It never asserts flow behaviour — UI wording, step order, how an error code renders — which
the app-harness E2E specs own ([`.claude/harness/README.md`](../../.claude/harness/README.md)); a step
status, an error code or a provider's verbatim text (test 5's `lecture-error-message`) is read only as
evidence of a packaging fact. Two flow checks stay here only because no harness spec covers them yet,
both in `lib/firstRun.js`: the privacy gate — the wall's first save opens the policy, and Confirm stays
disabled until `.privacy-body` is scrolled to its end (test 4, and test 14 when the policy opens) — and a canceled folder dialog
keeping the launcher's default (test 4). The boundary is the
root [`CLAUDE.md`](../../CLAUDE.md#test-boundaries)'s test boundaries.

| Test                    | The failure only packaging can cause                                                                                                 | Harness flow side                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 1. fresh install        | the per-user NSIS install fails, `resources/` drifts from `BOOT.md`'s tree, the shipped native host breaks | —                                                  |
| 2. DLL imports          | an installed binary imports a DLL a clean PC lacks                                                                                   | —                                                  |
| 3. boot                 | the launcher spawns out of order, a bundled tool is unusable, `bin/` and the probed tools differ, a service runs without the secret  | —                                                  |
| 4. first run            | main's native folder dialog over IPC breaks, keys land in `settings.json` unencrypted, a probe reaches the network instead of `unverified` | `first-run-and-data-folder.spec.mjs`               |
| 5. provider steps       | the bundled ffmpeg is not spawned by path; a frozen SDK fails to import or build a request, rather than failing on the network       | `failure-surfacing.spec.mjs`                       |
| 6. the PDF              | bundled pandoc or tectonic fails, the shipped `.fmt` is rebuilt rather than reused, Hebrew glyphs drop                               | `recitation-pipeline.spec.mjs`                     |
| 7. live SSE             | SSE never reaches the document under `app://bundle` with the launch secret, so the page needs a reload                              | `recitation-pipeline.spec.mjs`                     |
| 8. drive off            | a fresh install's defaults run a step past the PDF or upload to Drive                                                                | —                                                  |
| 9. opening a PDF        | `open-pdf` fails through the preload bridge and `shell.openPath`; a real Windows exclusive handle is not reported as `file_locked`   | `locked-file.spec.mjs`                             |
| 10. yt-dlp download     | yt-dlp cannot find the bundled ffmpeg to merge DASH, the state root's yt-dlp copy is not seeded, `/video-arrived` is never reported  | `download-all.spec.mjs`                            |
| 11. quit, no orphans    | a frozen process or port outlives the launcher's teardown; settings do not persist across a relaunch                                 | —                                                  |
| 12. Hebrew temp path    | a bundled tool breaks under a non-ASCII `TEMP`; the frozen services do not write UTF-8 to `launch.log`                               | —                                                  |
| 13. the browser chain   | the prerequisite misresolves installed Chrome or Edge; the PDF step depends on a browser                                             | —                                                  |
| 14. an in-place update  | the updater fails to replace `resources/` from a feed, or loses the keys, the yt-dlp copy or the new `.fmt`                          | —                                                  |

A new smoke test adds its row here; a test with no packaging-only failure belongs in the harness or a unit test.

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
