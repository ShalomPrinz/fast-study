# Release

## The installer

One unsigned per-user NSIS `.exe`, built by `.github/workflows/build.yml` on `windows-latest` in
under 10 minutes — most of it the LaTeX prime, the freeze and the two installer builds — before the
smoke job. The prime is network-bound, so it starts first — tectonic and pandoc download ahead of the
GitHub API version steps — and runs in the background beside the freeze and the frontend build; a
wait step collects its log and exit code before staging. It tops up a cache restored by exact key
and always runs; only a passed wait saves it ([LATEX.md](LATEX.md#across-runs)). The installer's own
configuration (one-click, per-user, the install directory) is electron's:
[`electron/CLAUDE.md`](../../electron/CLAUDE.md#packaging).

Unsigned means **SmartScreen blocks the first run** on every machine: "Windows protected your PC"
with only Don't run, and the installer starts from **More info → Run anyway**. Nothing short of an
OV/EV certificate avoids it. The LaTeX cache ships with tectonic's prebuilt format
([LATEX.md](LATEX.md#the-prime)), so no render writes under the install directory.

### The macOS app

`build-mac` builds the same staged tree on `macos-15` as an arm64-only `FastStudy.app`: a `.dmg` to
download, and a `.zip` plus `latest-mac.yml` for the launcher's own updater
([`electron/docs/UPDATES.md`](../../electron/docs/UPDATES.md#the-macos-install-step)). It is
**ad-hoc signed, never notarized**, so Gatekeeper blocks the first run until the user picks Open
Anyway in System Settings. Unsigned code does not run at all on arm64 macOS, so the job fails unless
`codesign --verify --deep --strict` passes on the bundle and `smoke/lib/macho.js` verifies every
Mach-O inside it, each native one (`MacOS/`, `bin/`, `services/`) carrying an arm64 slice — a
Mac with Rosetta runs an x86_64 one, a user's Mac may have none. Everything is staged before `npm run dist:mac`, which seals
the bundle; a file changed afterwards breaks the signature.

It runs after `build` only to read its outputs — the app version, the previous version and the
extension version — so both platforms ship one version and `extension-version.txt` stays one file.
The frontend is built again there with the same inputs, the freeze uses PyInstaller's stock
bootloader (the Windows job compiles its own only for Defender), and the LaTeX cache is primed on
the runner under its own key ([LATEX.md](LATEX.md#across-runs)). Its summary lists the measured size of the dmg, the
zip and each tool.

## Build, test, publish

Two workflows, neither taking an input, and a third that only re-tests
([re-running smoke](#re-running-smoke)).

- **`build.yml`** runs on every push to `main` or a `claude/**` branch — so a cloud session, which
  can push only its own branch and has no `gh`, still gets a full build and smoke run — and on
  dispatch; a superseded run on the same ref is cancelled. It
  builds with `--publish never` and uploads the installer, its `.blockmap`, `latest.yml` and
  `extension-version.txt` ([the extension version](#the-extension-version)) as the
  `installer` artifact (90 days), plus `installer-previous`, the same staged tree at a lower version
  with its own `latest.yml`, which exists only for the smoke suite's update check and never leaves
  Actions. `build-mac` uploads `installer-mac` (the dmg, the zip, `latest-mac.yml`; 90 days) and
  `installer-mac-previous` (a lower version's zip and `latest-mac.yml`) the same way. Each build
  fails if the shipped `app-update.yml` does not name this repo's GitHub Releases — the
  smoke job rewrites that file, so it cannot check it. The smoke job — `smoke-suite.yml`, called as
  `smoke / smoke` — installs the artifact on a fresh runner and runs
  `smoke/`; on failure it uploads `smoke-logs` (per-launch `launch.log`s, the state root's own, the
  failing test's DOM snapshot, ~60KB) and `smoke-traces` (Playwright traces, ~11MB), and whatever
  the outcome `boot-timing` (90 days). `smoke-mac / smoke-mac` is the same workflow's macOS job on
  `installer-mac` ([SMOKE.md](SMOKE.md#the-macos-suite)), uploading `smoke-mac-logs` whatever the
  outcome and `smoke-mac-traces` on failure; `build.yml` calls the workflow once per platform
  (`target`), so neither smoke waits on the other platform's build. The run is
  green only when all four jobs pass. It writes nothing to Releases. A branch run's artifact never
  reaches a Release: publish.yml takes only `main`'s runs, so a commit fast-forwarded from a branch
  releases once `main`'s own `build.yml` run of it is green.
- **`publish.yml`**, dispatched by hand on the commit to release, builds nothing. It first walks back
  over `github-actions[bot]` commits that touch only `site/img/` — `pages.yml`'s screenshot refresh,
  which no build runs on — to the first other commit, and releases that one. It takes the
  `installer` artifact of `build.yml`'s newest green `main` run for that commit, reads the version off its
  `latest.yml`, refuses if Release or tag `v<version>` exists, takes the same run's `installer-mac`,
  checks all seven files are there (the four Windows ones, `FastStudy-mac-arm64.dmg`,
  `FastStudy-mac-arm64.zip`, `latest-mac.yml`) and that both feeds name one version, and
  creates Release `v<version>`, published and targeted at that commit, with the same run's
  `boot-timing.json` attached when it has one — a notice, not a failure, when it does not. It ends by dispatching
  `pages.yml` to refresh the landing page's version line: a `release: published` trigger cannot, as
  an event `GITHUB_TOKEN` raises starts no workflow except a dispatch
  ([docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)).
  A failed dispatch fails the run with the Release already out; run `gh workflow run pages.yml --ref main`.

Nothing reaches installed copies until `publish.yml` runs; `latest.yml` is what their updater reads —
the launcher's side is [`electron/docs/UPDATES.md`](../../electron/docs/UPDATES.md). An expired
`installer` artifact makes `publish.yml` fail naming the commit; dispatching `build.yml` on it builds
and smoke-tests a fresh one.

A branch other than `main` or `claude/**` builds only on dispatch:
`gh workflow run build.yml --ref <branch>` runs all four jobs at that branch's workflow files and
publishes nothing, since `publish.yml` reads `main`'s runs only.

### Re-running smoke

`smoke.yml`, dispatch only, runs `smoke-suite.yml` at the dispatched ref against the installers of
the `build.yml` run named by its required `run-id`, so a fix to `smoke/` is retried without the
~8 minute build. A guard job first refuses, naming the fix, a run that is not `build.yml`'s, whose
`build` or `build-mac` job did not succeed (the run itself may have failed in smoke), or one of whose
four installer artifacts has expired — and any run whose commit's tree differs from the ref's outside
`delivery/smoke/`, listing the differing paths. Tree equality, not ancestry: nothing under
`delivery/smoke/` reaches the installer, so only then is the old installer the app this ref builds;
any other change means dispatching `build.yml` instead. A green `smoke.yml` run publishes nothing:
`publish.yml` reads `build.yml` runs only, so a release still needs a green `main` `build.yml` run for
its commit. It uploads no `boot-timing`, since its file would name its own run and commit rather than
the installer's build.

`.claude/skills/debug-ci/` reads both smoke artifacts by name and inner layout from outside
`delivery/`; nothing here fails when a rename breaks it, so change it in the same pass.

## Boot timing

Each build.yml run uploads its smoke run's `boot-timing.json` ([SMOKE.md](SMOKE.md#boot-timing)) as
the `boot-timing` artifact, which expires after 90 days; publish.yml attaches the same file to the
Release, where it does not expire. electron-updater reads only `latest.yml`, so the extra asset is
invisible to it.

`node delivery/boot-timing.mjs` runs two stages, or one when named (`collect` / `view`; `--repo owner/name`
picks another repo):

- **`collect`** grows `delivery/boot-timing.local.json` (git-ignored) through `gh`: one entry per
  completed build.yml run on `main`, keyed by run id, holding its `boot-timing.json` plus
  `created_at`, `head_sha` and `release` (tag or `null`). A Release maps to its run through the
  asset's `run_id`, never the sha; when that run's artifact has expired the asset becomes the entry,
  dated by the run's API record or, once that is gone too, by the Release's `created_at`. Two
  cursors make it incremental: runs stop one second short of the oldest unfinished run, so that run
  is listed again next time, and releases at the newest `published_at` seen. Runs and Releases
  without the file are skipped with a line. It fails naming why when `gh` is missing or logged out.
- **`view`** serves the chart on `127.0.0.1` at an ephemeral port, rebuilding the page from the
  store on every request, so a refresh after a `collect` shows new data. It needs no `gh`; with both
  stages, a failed `collect` still views what is stored.

## Versions

`build.yml` computes the version: major and minor from `electron/package.json` (its patch is
ignored), patch one past the highest non-draft Release `v<major>.<minor>.<n>`, else 0 — so bumping
the minor starts a new series. It is injected with `-c.extraMetadata.version` and becomes the tag,
`latest.yml`'s version and `app.getVersion()`. The installer is always `FastStudy-Setup.exe`, so
`releases/latest/download/FastStudy-Setup.exe` is a stable link, as are `FastStudy-mac-arm64.dmg`
and the updater's `FastStudy-mac-arm64.zip`; a differential update still needs
the tag to be `v<version>`, since electron-updater finds the old blockmap by swapping the version in
its download URL. Two builds before a publish compute the same version, so publishing the second
refuses on the existing Release; re-dispatch `build.yml` for a fresh one.

### The extension version

Main recopies the extension into Chrome's folder only when the shipped `manifest.json` version
differs from the copy's ([`electron/docs/EXTENSION.md`](../../electron/docs/EXTENSION.md)), so it
must change exactly when a shipped extension file does — at most once per release. `build.yml`'s
`extension` step computes it with `extension-version.mjs` against the newest non-draft Release:
that Release's version, read from its `extension-version.txt` asset, plus one patch when
`git diff` from its tag to HEAD touches a file `stage.mjs` ships under `downloader/extension/`
(the manifest counts only for a change beside its `version`); a committed major.minor above it
ships as `<major>.<minor>.0`. `stage.mjs` stamps the result into the staged `manifest.json` only,
and publish.yml uploads `extension-version.txt` beside `latest.yml`. The committed manifest's patch
is therefore meaningless — only its major.minor is read, as a deliberate bump. A Release without the
asset falls back to the manifest at its tag ([`docs/MIGRATIONS.md`](../../docs/MIGRATIONS.md)).
`node delivery/extension-version.mjs <tag> [<recorded>]` prints the version and its reason locally.

## Error reporting

Two optional secrets; a fork or a build without them still produces an installer that sends nothing.

- **`FASTSTUDY_SENTRY_DSN`** is baked twice: into the frontend bundle as `VITE_SENTRY_DSN`, and
  into the asar's `package.json` as `sentryDsn` via `-c.extraMetadata.sentryDsn` — passed only when
  set, so an empty secret leaves the key absent. Main hands it to every child
  ([`lib/sentry/CLAUDE.md`](../../lib/sentry/CLAUDE.md)).
- **`SENTRY_AUTH_TOKEN`** (an org token, so org and region route themselves; `vars.SENTRY_ORG` is
  optional) makes the frontend build upload hidden source maps to `faststudy@<version>`, with
  `FASTSTUDY_VERSION` set from the computed version. The frontend builds once per platform, so each
  previous-version build reuses its bundle and a run uploads twice into the one release. Only `main`'s
  runs get the token: a branch computes the version `main`'s next build will, so its maps would
  land in that release; without it vite loads no plugin and emits no maps, and the DSN is still baked.

The smoke run's installs carry the DSN, but the per-program firewall blocks every event they send —
on Windows only: the macOS suite sets up no firewall and never turns reports on, which are off until
the privacy policy is confirmed.

## Pinned tool versions

`build.yml` downloads the bundled binaries at pinned versions, each a claim the repo has measured —
moving one re-opens that measurement, so surface it rather than bump it:

- **tectonic 0.17.0** — the engine the shipped cache was primed against ([LATEX.md](LATEX.md)) and
  the glyph-for-glyph comparison against xelatex ([`backend/docs/PDF.md`](../../backend/docs/PDF.md))
  was measured on; the render also leans on its unstable `-Z continue-on-errors`.
- **pandoc 3.13** — `backend/assets/templates/` is its stock template plus one partial, and
  `text_direction.lua` reads its Lua table API (`colspecs`, which 2.9 lacks), so the binary and
  both move together ([`backend/docs/PDF.md`](../../backend/docs/PDF.md#the-pandoc-pin-and-the-template));
  a move also re-opens the sink ([LATEX.md](LATEX.md#kitchen-sinkmd)). Its `pandoc.exe` is 239MB
  unpacked; pinning 3.13 over 2.9 makes the installer 14MB larger.
- **ffmpeg 9.0.2** — pinned only so a build is reproducible; bump it for upstream security fixes.
- **PyInstaller 6.22.3** — installed from its sdist with the bootloader compiled by MSVC on the
  runner, because Defender quarantines the stock prebuilt one, which malware shares. The sdist
  still carries the stock `run.exe`, so the freeze step fails if ours hashes equal to the
  win_amd64 wheel's.
- **yt-dlp is deliberately unpinned** — it rots as YouTube changes signatures, so a build ships the
  newest.

`lib/tools/` only probes that a binary spawns; it never checks a version.

macOS takes the same pins as official darwin-arm64 releases —
`tectonic-0.17.0-aarch64-apple-darwin.tar.gz`, `pandoc-3.13-arm64-macOS.zip` and the unpinned,
universal `yt-dlp_macos` — except ffmpeg.

### The macOS ffmpeg

No official arm64 macOS build exists, so `ffmpeg-mac.sh` compiles `FFMPEG_VERSION` from
`ffmpeg.org`'s tarball with LAME 3.100, both pinned by sha256 in `build.yml`'s `env`. The result is
cached under `ffmpeg-macos-arm64-<ffmpeg>-lame<lame>-min<deployment target>-<hash of the script>`
and saved only after the checks pass. LAME is configured `--enable-static --disable-shared
--disable-frontend`, so there is only a static library to link and no `lame` program. ffmpeg's
configure line, each flag a decision — **a codec or protocol the app comes to need is added here**:

| Flag                                 | Why                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `--disable-autodetect`               | Nothing on the runner (Homebrew, the SDK's optional libraries) is linked by accident. It also turns off zlib, the TLS backend and VideoToolbox, so the two the app needs are named below |
| `--enable-libmp3lame`                | The pipeline writes `audio.mp3` and ffmpeg has no native MP3 encoder                        |
| `--enable-securetransport`           | TLS through macOS's own `Security.framework`, so `https://` inputs open as on Windows with no OpenSSL or GnuTLS to ship |
| `--enable-zlib`                      | The system `/usr/lib/libz.1.dylib`: compressed HTTP responses, `mov`/`matroska` compressed headers and the zlib-backed decoders (PNG among them) |
| `--extra-cflags` / `--extra-ldflags` | Point at the static LAME's prefix; with no shared LAME there, the link is static            |
| `--disable-shared`                   | One self-contained binary                                                                   |
| `--disable-ffprobe`, `--disable-ffplay`, `--disable-doc` | Nothing spawns them                                                     |
| `--disable-debug`                    | No debug symbols in a shipped binary                                                        |

Every native decoder, encoder, muxer and filter stays on by default. `--enable-gpl`,
`--enable-nonfree` and `--enable-version3` are absent, so the binary is LGPL 2.1.
`MACOSX_DEPLOYMENT_TARGET` is the `LSMinimumSystemVersion` of Electron's own `Info.plist`, compared
with the built app's afterwards. The `electron` npm package has no install script, so `npm ci` leaves
no binary: the step runs the package's `install.js`, which fetches the locked version's
checksum-verified zip — the same release zip `electron-builder` downloads and packs.

The build fails unless the binary, cached or fresh, passes: `otool -L` lists only `/usr/lib/` and
`/System/` paths; `vtool -show-build` reports a `minos` no higher than that version; it is arm64;
its configuration names none of the three licence flags; `-encoders` lists `libmp3lame`; `-protocols` lists `https`; and `-decoders` lists `zlib`, which
configure builds only with zlib found.

## The frozen bundle

`services.spec` builds `services/faststudy-services.exe` (no suffix on macOS), one one-dir bundle picked by `argv[1]` through `entry.py`. Its
rules are [`delivery/CLAUDE.md`](../CLAUDE.md#the-frozen-bundles-invariants); the spec's own decisions:

- **One Drive discovery document.** Of googleapiclient's 582 the bundle keeps `drive.v3.json`, the
  only client the app builds — the rest are 97MB. The prune runs on the finished TOC, since
  PyInstaller's own hook collects them a second time, and the build fails if the one is missing:
  otherwise it surfaces only as a failed upload on a user's machine.
- **`lib/` source dirs on `pathex`.** Consumers install them editable, and PyInstaller never runs the
  `.pth` hook, so `runtime`, `logging_setup`, `tools` and `sentry_policy` are otherwise unresolvable.
- **No Sentry hidden imports.** `sentry_sdk` loads its integrations by import string, but
  pyinstaller-hooks-contrib's `hook-sentry_sdk` collects the default and auto-enabling ones
  (`fastapi`, `starlette`, `logging` among them).
- **No native-library collection for figures.** hooks-contrib's `hook-pypdfium2`/`hook-pypdfium2_raw`
  collect pdfium (about 11MB with Pillow, on Linux) and the `version.json` read at import; PyInstaller's
  `hook-PIL.Image` collects the lazily imported `*ImagePlugin`s. The backend imports both at boot,
  so a lost library fails smoke test 3, not a user's first figure.
- **UTF-8 mode** (`X utf8=1`): piped stdio on Windows otherwise takes the ANSI codepage, and a Hebrew
  log line reaches `launch.log` escaped or not at all.
- **`console=True`**: the launcher reads the port line off stdout, and tool spawns stay hidden by
  sharing the service's hidden console ([`lib/tools/CLAUDE.md`](../../lib/tools/CLAUDE.md)).

## Staging

`stage.mjs` copies the four built services into the packaged tree
[`electron/docs/BOOT.md`](../../electron/docs/BOOT.md#dev-and-packaged-spawns) lists, which
`electron/package.json`'s single `extraResources` entry ships as `resources/`. `bin/` and `latex/`
are not its business: the workflow downloads the binaries and primes the cache straight into
`stage/`, so nothing is copied twice. On macOS the tree lands in `FastStudy.app/Contents/Resources/`,
and the build fails if a tool or `faststudy-services` lost its exec bit on the way.

`auto` and `server` stage under `downloader/` beside the workspace's one hoisted `node_modules`, so
the installer carries a single copy of their shared dependencies; the workspace's links to its own
packages are dropped. It refuses to finish if a `@faststudy/*` dependency is a symlink: `file:` deps
install as links by default, and a link into `lib/` dangles once the tree leaves the repo — so
`downloader/.npmrc` sets `install-links`.

Symlinks are copied verbatim (`verbatimSymlinks`): `cpSync` otherwise rewrites each relative link
into an absolute path back into the build output, and electron-builder ships a link as written. On
macOS PyInstaller's `_internal/` is built on relative links — `Python.framework`'s `Python`,
`Resources` and `Versions/Current`, plus one top-level link per nested library — and `codesign`
rejects a framework whose root links do not point into `Versions/` ("unsealed contents present in
the root directory of an embedded framework"). So the stage refuses to finish on any link that is
absolute, dangling or leaves the tree, and a failed `build-mac` prints every nested `.framework` and
`.app` layout in the stage and the built app.

It also stages the Chrome extension (`downloader/extension/`, minus its `CLAUDE.md`) as `extension/`,
stamped with [the extension version](#the-extension-version) when one is passed as its second argument,
and the native host script `electron/bridge/host.js` as `bridge/host.js`, both read by main at launch
([`electron/docs/EXTENSION.md`](../../electron/docs/EXTENSION.md)) — about 100KB, no binary.
