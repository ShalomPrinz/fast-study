# delivery/

Build-time inputs that turn the repo into a Windows installer and prove it. Nothing here ships or
runs at runtime, and no dev command touches it. Owned by `delivery-dev`, together with
`.github/workflows/{build,publish}.yml`.

| File                                | What it is                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `services.spec` + `entry.py`        | The PyInstaller one-dir bundle holding `backend/` and `database/`, `argv[1]` |
| `stage.mjs`                         | Assembles `stage/`, the tree electron-builder ships as `resources/`          |
| `prime_cache.py`                    | Fills tectonic's LaTeX package cache with everything the app can render      |
| `kitchen-sink.md` + `probe.png`     | The document the prime renders                                               |
| `cache-supplement.txt`              | Cache files the sink does not pull, added by name                            |
| `tectonic-cache-filelist-linux.txt` | A sink-only primed cache's contents, kept as a diff baseline                 |
| `smoke/`                            | The release smoke suite and its fixtures, with its own `package.json` + lock |

## Commands

```bash
cd backend && uv run --with pyinstaller pyinstaller ../delivery/services.spec   # freeze
cd backend && uv run python ../delivery/prime_cache.py <out-dir> [--filelist f] # prime
node delivery/stage.mjs delivery/stage                                          # stage
cd delivery/smoke && npm ci && npx playwright test --list                       # parse the suite
```

Only `.github/workflows/build.yml` on `windows-latest` produces an installer: neither PyInstaller nor
electron-builder's NSIS target cross-compiles, so WSL can freeze a Linux bundle, prime and stage, but
never build or run the release. A Linux freeze is checked by running `services database|backend`
with `FASTSTUDY_PORT=0` for the port line and `/health`.

## Rules

- **Reproducible from committed content.** Everything a workflow reads is tracked, except
  `backend/credentials.json`, which arrives as the `GOOGLE_CREDENTIALS_JSON` secret; a build without
  it still produces an installer, one that cannot do Drive consent.
- **Published bytes are the bytes the smoke job tested.** `publish.yml` never builds and takes no
  input; no build step may run after the smoke job — [RELEASE.md](docs/RELEASE.md#build-test-publish).
- **Pinned tool versions are measured claims** — moving one re-opens what it was measured against
  ([RELEASE.md](docs/RELEASE.md#pinned-tool-versions)).
- **The spec's invariants bind `backend/` and `database/`** — see below. Not this folder's to relax.
- **The packaged tree is [`electron/docs/BOOT.md`](../electron/docs/BOOT.md#dev-and-packaged-spawns)'s.**
  `stage.mjs` builds it and the smoke suite asserts it; every name in it belongs to a consumer.
- **The smoke suite's dependencies are its own** — nothing it installs reaches `resources/`.

## The frozen bundle's invariants

`backend/` and `database/` ship as **one** PyInstaller one-dir bundle, `services`, with the service
picked by `argv[1]`; `services.spec` is the build and `entry.py` its entry point.

The build runs out of `backend/`'s environment, which works only because **`database/`'s
dependencies are a strict subset of `backend/`'s**. That is an invariant nothing checks: a
dependency added to `database/` alone would be absent from the bundle and fail at runtime on a
clean machine, so it has to be added to `backend/pyproject.toml` too.

PyInstaller's module graph is flat, so no top-level module name may appear in both services. That is
why the entry points are `backend_main.py` and `database_main.py` rather than two `main.py`, and it
is a live constraint on every new top-level module: `backend/` owns `course`, `pipeline`,
`services`, `timing`; `database/` owns `events`, `fs`, `settings`. The generic names on the
`database/` side are the ones a future dependency could collide with — `fs` is a real PyPI package.

Freezing moves `__file__` inside the bundle, so **every read-only file that ships with the code
resolves through `resource_path()`** (`backend/services/resources.py`), never a `__file__` walk —
`assets/` and `credentials.json`. Binaries are not among them: they resolve through `lib/tools/` off
`FASTSTUDY_BIN_DIR`, which freezing does not affect.

## Docs

| Doc                                | Covers                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| [RELEASE.md](docs/RELEASE.md)      | The installer, build → test → publish, versions, pins, the frozen bundle, stage |
| [LATEX.md](docs/LATEX.md)          | Priming the shipped tectonic cache: the sink, the supplement, the baseline      |
| [SMOKE.md](docs/SMOKE.md)          | The release smoke suite's rules and what only a Windows run proves              |
