# CLAUDE.md — electron (the launcher)

## What this is

The desktop shell: one Electron main process that opens a window on its launch screen, starts the
four services, waits for them to be healthy, and navigates that window to the built frontend. It holds no product logic — no pipeline, no
paths, no HTTP surface of its own. What it owns is the launch: the per-launch secret, the spawn
order, the port handshake, the settings store the children's environment comes from, and killing
everything on quit.

| File          | Owns                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| `main.js`     | The launch: secret, child specs, ports, health, window, teardown, log, shell   |
| `protocol.js` | The `app://bundle` scheme and serving `frontend/dist` over it                   |
| `store.js`    | The settings store — JSON under `userData`, API keys through `safeStorage`      |
| `checks.js`   | The startup checks — the machine-level facts the app degrades on                |
| `preload.js`  | `window.faststudy` — URLs, secret, settings backing, checks, the open bridge    |
| `boot.html`   | The launch screen — what is on screen while the four children start             |
| `boot.js`     | Its renderer: the snapshot, the pushes, Try again and Quit                      |

Read [`docs/BOOT.md`](docs/BOOT.md) for the launch sequence and [`docs/RENDERER.md`](docs/RENDERER.md)
for the scheme, the bridge and the store.

## Run

```bash
npm run app                  # from the repo root: builds frontend/dist, then launches
npm --prefix electron start  # launch alone, against whatever frontend/dist already holds
```

There is no dev server in this path: the window loads the **built** bundle over `app://bundle`, so a
frontend change needs `npm --prefix frontend run build` before it shows up. `npm run dev` at the repo
root is the other way to work — five processes, the Vite origin, no launcher, no secret — and both
stay supported.

## Verifying a change

This package has no test suite, and it could not have a useful one: what it does is spawn four real
processes and wait on them. A launch plus its log is the whole empirical check, and the WSL dev box
runs WSLg (`DISPLAY=:0`, `/mnt/wslg`), so a real window opens here.

```bash
timeout 90 npm --prefix electron start   # SIGTERM at 90s exercises the teardown path
pgrep -af 'services|database_main|backend_main|app.js|src/index.js'   # must find nothing after
```

Then read `<state root>/logs/launch.log`. A healthy dev run ends with all four `ready on
http://127.0.0.1:<port>`; `{"secureStorage":false}` in the startup-checks line is the expected WSL
result and not a failure, since `safeStorage` has no keyring to bind to there.

## CommonJS, deliberately

Every other JS package in the repo is ESM; this one is not. A sandboxed preload script cannot be an
ES module — Electron loads ESM preloads only with an `.mjs` extension and an unsandboxed renderer —
and splitting one four-file package across both module systems to gain nothing is worse than
matching Electron's own default. `eslint.config.js` gives `electron/**/*.js` its own
`sourceType: 'commonjs'` block for the same reason.

## What it must not become

- **No product logic.** A rule about courses, lectures, paths or the pipeline belongs in the service
  that owns it. Main is a launcher and a window.
- **No second writer of the on-disk layout.** Main never touches `DATA_ROOT`; the services reach
  disk through `database/`, and main only passes the root down as an env var.
- **No spelling of its own for the launch contract.** `FASTSTUDY_PORT`, `FASTSTUDY_SECRET`,
  `FASTSTUDY_STATE_DIR`, `FASTSTUDY_BIN_DIR`, `X-FastStudy-Secret`, `app://bundle` and the
  `^FASTSTUDY_PORT=(\d+)$` line are the same names `lib/runtime/` implements on the service side. A
  change to any of them is a cross-service change, not an edit here.

## Packaging

`npm run dist` runs electron-builder for Windows and produces an unsigned **per-user** NSIS
installer (`perMachine: false`), so it installs into `%LOCALAPPDATA%\Programs\FastStudy` and adds no
UAC prompt on top of SmartScreen. The whole configuration is the `build` block in `package.json`.

- **The asar holds this package's own files only** — the ones listed under `files`. The four
  services, the built frontend, the binaries and the LaTeX cache ship as `extraResources` from
  `delivery/stage/`, which the release workflow stages in exactly the tree
  [`docs/BOOT.md`](docs/BOOT.md) lists, and land under `process.resourcesPath` where main looks.
- **No `asarUnpack`.** Playwright's driver needs a real filesystem path, and `auto/` is
  extraResources — already outside the asar. Nothing that ships inside the asar spawns anything.
- **The icon is `assets/icon.ico`, named explicitly** rather than left to electron-builder's default
  `buildResources` directory: that default is `build/`, and the repo's root `.gitignore` ignores
  `build/` wholesale as PyInstaller's output. The output directory stays the default `dist/`, which
  the same file already covers.
