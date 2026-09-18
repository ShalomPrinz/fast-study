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
| `report.js`   | The error report's `mailto:` — recipient, encoding, the trim to the size cap    |
| `store.js`    | The settings store — JSON under `userData`, API keys through `safeStorage`      |
| `updater.js`  | The update check — electron-updater against GitHub Releases, silent            |
| `checks.js`   | The startup checks — the machine-level facts the app degrades on                |
| `preload.js`  | `window.faststudy` — URLs, secret, settings backing, checks, the open bridge    |
| `boot.html`   | The launch screen — what is on screen while the four children start             |
| `boot.js`     | Its renderer: the snapshot, the pushes, Try again and Quit                      |

Read [`docs/BOOT.md`](docs/BOOT.md) for the launch sequence, [`docs/RENDERER.md`](docs/RENDERER.md)
for the scheme, the bridge and the store, and [`docs/UPDATES.md`](docs/UPDATES.md) for how a
packaged app updates itself.

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

Two checks, because the package is two kinds of code.

**The boot path is verified by a real launch and its log** — what it does is spawn four real
processes and wait on them, so nothing short of that proves it. The WSL dev box runs WSLg
(`DISPLAY=:0`, `/mnt/wslg`), so a real window opens here.

Launch it with `npm --prefix electron start` and read `<state root>/logs/launch.log`. A healthy dev
run ends with all four `ready on http://127.0.0.1:<port>`; `{"secureStorage":false}` in the
startup-checks line is the expected WSL result and not a failure, since `safeStorage` has no keyring
to bind to there.

**Teardown is verified by signalling the electron main process itself** — never by wrapping the
launch in `timeout`, which signals `npm`, leaving electron to die _by_ SIGTERM with its
`process.on('SIGTERM')` handler never running, so `killChildren()` never fires and all four children
are orphaned.

```bash
electron/node_modules/electron/dist/electron . &        # the real binary — .bin/electron is a node shim whose pid is not main's
kill -TERM "$(pgrep -f 'electron/dist/electron \.$')"   # once the log shows all four ready
pgrep -af 'services|database_main|backend_main|app.js|src/index.js'   # must find nothing after
```

The log then ends with `[server] exited (SIGTERM)`. That `pgrep` pattern matches the same processes
under any launch, so a concurrent `npm run dev` — including one in a sibling worktree — shows up as
hits that are not orphans; tell them apart by `/proc/<pid>/cwd` rather than reading the check as a
failure.

**The pure logic has a test suite** — `npm --prefix electron test`, `node --test` with no dependency,
covering `resolveWithin`'s path containment, the store's tables and refusal rules, and `report.js`'s
`mailto:` trimming. It runs under plain `node`: no display, no Electron binary, no spawned service.
`tests/stubElectron.js` is how — it puts a fake `electron` in the module cache before the module
under test is required, which is also the switch the unavailable-keystore and failed-decrypt paths
are reached through. Nothing that spawns or waits on a process is in it.

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

`npm run dist` runs electron-builder for Windows and produces an unsigned **one-click per-user** NSIS
installer (`oneClick: true`, `perMachine: false`): it installs into `%LOCALAPPDATA%\Programs\faststudy`
with no wizard, no directory choice and no UAC prompt on top of SmartScreen. The directory is fixed
because a folder chosen under `C:\` inherits an ACL other local accounts can write to, so another
account could swap a shipped binary such as `resources/bin/ffmpeg.exe`. The whole configuration is
the `build` block in `package.json`.

- **The install-directory leaf is `name` (`faststudy`), not `productName`.** For a one-click
  per-user build `NsisTarget.js` calls `getWindowsInstallationDirName(appInfo, !oneClick ||
  isPerMachine)`, which returns `sanitizedName` when false. `userData` and the state root are named
  from `productName` and do not move; the exe and uninstaller inside stay `FastStudy.exe` /
  `Uninstall FastStudy.exe` (`common.nsh` uses `PRODUCT_FILENAME`).

- **The asar holds this package's own files only.** The four services, the built frontend, the
  binaries and the LaTeX cache ship as `extraResources` from `delivery/stage/`, which the build
  workflow stages in exactly the tree [`docs/BOOT.md`](docs/BOOT.md) lists, and land under
  `process.resourcesPath` where main looks.
- **`files` is globbed — `*.js`, `*.html`, `package.json` — never a hand-listed set.** A source file
  missing from that list is simply absent from the asar, and the only symptom is `Cannot find
  module` on the first launch of a packaged build: dev and lint both stay green, and WSL cannot
  produce the failure. The globs match every top-level source file and nothing else — `node_modules`
  electron-builder force-excludes and collects separately from `dependencies`, `dist/` is the
  output directory, and `assets/`, `docs/`, `tests/` and `package-lock.json` match neither. The trade
  is that a top-level `.js` added here that is _not_ meant to ship would ship.
- **No `asarUnpack`.** Playwright's driver needs a real filesystem path, and `auto/` is
  extraResources — already outside the asar. Nothing that ships inside the asar spawns anything.
- **Updates are silent and packaged-only.** `updater.js` checks GitHub Releases once per launch,
  downloads in the background and lets NSIS install on quit — nothing on screen, `launch.log` the
  whole surface. The installer replaces `resources/` wholesale, which is why nothing that must
  survive an update lives there. See [`docs/UPDATES.md`](docs/UPDATES.md).
- **The icon is `assets/icon.ico`, named explicitly** rather than left to electron-builder's default
  `buildResources` directory: that default is `build/`, and the repo's root `.gitignore` ignores
  `build/` wholesale as PyInstaller's output. The output directory stays the default `dist/`, which
  the same file already covers.
