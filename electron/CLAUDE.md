# CLAUDE.md — electron (the launcher)

## What this is

The desktop shell: one Electron main process that starts the four services, waits for them to be
healthy, and opens a window on the built frontend. It holds no product logic — no pipeline, no
paths, no HTTP surface of its own. What it owns is the launch: the per-launch secret, the spawn
order, the port handshake, the settings store the children's environment comes from, and killing
everything on quit.

| File          | Owns                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| `main.js`     | The launch: secret, child specs, port parse, health wait, window, teardown, log |
| `protocol.js` | The `app://bundle` scheme and serving `frontend/dist` over it                   |
| `store.js`    | The settings store — JSON under `userData`, API keys through `safeStorage`      |
| `preload.js`  | `window.faststudy` — the four URLs, the launch secret, the settings backing     |

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

`electron-builder` and the installer are not in this package yet. What main already assumes about a
packaged tree is one thing — that `process.resourcesPath` holds `services/`, `auto/`, `server/`,
`frontend/`, `bin/` and `latex/` — and it is listed in [`docs/BOOT.md`](docs/BOOT.md) so the build
that creates them has one place to match.
