# Release

## The installer

One unsigned per-user NSIS `.exe`, built by `.github/workflows/build.yml` on `windows-latest` in
roughly 20 minutes — most of it the LaTeX prime and ~450MB of binary downloads — before the smoke
job. The installer's own configuration (one-click, per-user, the install directory) is electron's:
[`electron/CLAUDE.md`](../../electron/CLAUDE.md#packaging).

Unsigned means **SmartScreen blocks the first run** on every machine: "Windows protected your PC"
with only Don't run, and the installer starts from **More info → Run anyway**. Nothing short of an
OV/EV certificate avoids it. The per-user install directory is writable, which is where tectonic
builds its `formats/` on the first render.

## Build, test, publish

Two workflows, neither taking an input.

- **`build.yml`** runs on every push to `main` — a superseded run is cancelled — and on dispatch. It
  builds with `--publish never` and uploads the installer, its `.blockmap` and `latest.yml` as the
  `installer` artifact (90 days), plus `installer-previous`, the same staged tree at a lower version
  with its own `latest.yml`, which exists only for the smoke suite's update check and never leaves
  Actions. It fails if the shipped `app-update.yml` does not name this repo's GitHub Releases — the
  smoke job rewrites that file, so it cannot check it. The smoke job installs the artifact on a fresh runner and runs
  `smoke/`; on failure it uploads `smoke-logs` (per-launch `launch.log`s, the state root's own, the
  failing test's DOM snapshot, ~60KB) and `smoke-traces` (Playwright traces, ~11MB), and whatever
  the outcome `boot-timing` (90 days). The run is
  green only when both jobs pass. It writes nothing to Releases.
- **`publish.yml`**, dispatched by hand on the commit to release, builds nothing. It takes the
  `installer` artifact of `build.yml`'s newest green run for that commit, reads the version off its
  `latest.yml`, refuses if Release or tag `v<version>` exists, checks all three files are there and
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
`releases/latest/download/FastStudy-Setup.exe` is a stable link; a differential update still needs
the tag to be `v<version>`, since electron-updater finds the old blockmap by swapping the version in
its download URL. Two builds before a publish compute the same version, so publishing the second
refuses on the existing Release; re-dispatch `build.yml` for a fresh one.

## Error reporting

Two optional secrets; a fork or a build without them still produces an installer that sends nothing.

- **`FASTSTUDY_SENTRY_DSN`** is baked twice: into the frontend bundle as `VITE_SENTRY_DSN`, and
  into the asar's `package.json` as `sentryDsn` via `-c.extraMetadata.sentryDsn` — passed only when
  set, so an empty secret leaves the key absent. Main hands it to every child
  ([`lib/sentry/CLAUDE.md`](../../lib/sentry/CLAUDE.md)).
- **`SENTRY_AUTH_TOKEN`** (an org token, so org and region route themselves; `vars.SENTRY_ORG` is
  optional) makes the frontend build upload hidden source maps to `faststudy@<version>`, with
  `FASTSTUDY_VERSION` set from the computed version. The frontend builds once, so the
  previous-version installer reuses the same bundle and there is one upload per run.

The smoke run's installs carry the DSN, but the per-program firewall blocks every event they send.

## Pinned tool versions

`build.yml` downloads the bundled binaries at pinned versions, each a claim the repo has measured —
moving one re-opens that measurement, so surface it rather than bump it:

- **tectonic 0.17.0** — the engine the shipped cache was primed against ([LATEX.md](LATEX.md)) and
  the glyph-for-glyph comparison against xelatex ([`backend/docs/PDF.md`](../../backend/docs/PDF.md))
  was measured on; the render also leans on its unstable `-Z continue-on-errors`.
- **pandoc 2.9.2.1** — pandoc 3.x crashes `text_direction.lua`
  ([`backend/docs/BIDI.md`](../../backend/docs/BIDI.md#the-direction-filter)), so the binary and
  `backend/assets/templates/pandoc_template.tex` only ever move together.
- **ffmpeg 9.0.2** — pinned only so a build is reproducible; bump it for upstream security fixes.
- **PyInstaller 6.22.3** — installed from its sdist with the bootloader compiled by MSVC on the
  runner, because Defender quarantines the stock prebuilt one, which malware shares. The sdist
  still carries the stock `run.exe`, so the freeze step fails if ours hashes equal to the
  win_amd64 wheel's.
- **yt-dlp is deliberately unpinned** — it rots as YouTube changes signatures, so a build ships the
  newest.

`lib/tools/` only probes that a binary spawns; it never checks a version.

## The frozen bundle

`services.spec` builds `services`, one one-dir bundle picked by `argv[1]` through `entry.py`. Its
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
- **UTF-8 mode** (`X utf8=1`): piped stdio on Windows otherwise takes the ANSI codepage, and a Hebrew
  log line reaches `launch.log` escaped or not at all.
- **`console=True`**: the launcher reads the port line off stdout, and tool spawns stay hidden by
  sharing the service's hidden console ([`lib/tools/CLAUDE.md`](../../lib/tools/CLAUDE.md)).

## Staging

`stage.mjs` copies the four built services into the packaged tree
[`electron/docs/BOOT.md`](../../electron/docs/BOOT.md#dev-and-packaged-spawns) lists, which
`electron/package.json`'s single `extraResources` entry ships as `resources/`. `bin/` and `latex/`
are not its business: the workflow downloads the binaries and primes the cache straight into
`stage/`, so nothing is copied twice.

It refuses to finish if either Node service's `@faststudy/*` dependency is a symlink: `file:` deps
install as links by default, and a link into `lib/` dangles once the tree leaves the repo — so both
services install with `npm ci --install-links`.
