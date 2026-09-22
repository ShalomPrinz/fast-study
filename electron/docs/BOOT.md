# Boot

## The sequence

1. `requestSingleInstanceLock()`. A second launch exits immediately and focuses the running window —
   two launchers would put two backends on one `timing.db` and two writers on one `DATA_ROOT`.
2. The `app://` scheme is registered as privileged **before** the app is ready; anything later is
   ignored and the scheme silently loses its origin. See [`RENDERER.md`](RENDERER.md).
3. One secret is generated for the launch: 32 random bytes, hex. It goes into every child's
   environment as `FASTSTUDY_SECRET` and reaches the renderer through the preload bridge.
4. The startup checks run once and are carried for the launch ([`RENDERER.md`](RENDERER.md)). They
   sit inline in the boot path, so each has to be cheap — no network, no spawn, no real disk work —
   and their duration is logged to catch one that stops being so.
5. The `BrowserWindow` is created and loads the launch screen, `boot.html` — see below.
6. The four children start **in dependency order** — `database → backend → auto → server` — one at a
   time. Each is spawned, its port read off stdout, and its `/health` waited on before the next
   starts.
7. All four healthy, the window navigates to `app://bundle/`. The frontend does not load before
   that: a renderer that loaded first would build its service clients at module scope against URLs
   that do not exist yet.

## The launch screen

`boot.html` and `boot.js`: one row per child, its state, and — once a child is up — anything its
`/health` tool probe could not run, one `<tool> <reason>` per unusable tool off the probe record's
`state` ([ERROR-CODES.md](../../docs/ERROR-CODES.md)). It is a plain `file://` page rather than
part of the frontend bundle, for the same reason the window cannot open on the frontend: the bundle
resolves the service URLs at module scope and none of them exist while it renders. It is English
only: the frontend's locale wiring does not reach it, and this is the only place in the app a tool
probe is shown.

Main pushes the whole state on `faststudy:boot` at every change, and the page reads one snapshot
over `faststudy:boot-state` when it loads — which closes the race with main's first push reaching a
page that has no listener yet.

A boot that fails anywhere **stays on the launch screen**, with the failure on the child that did not
come up, the message, and the path to the log. Everything that did start is killed first, so no row
still reads ready and a retry cannot leave a second copy of a service holding a port. **Try again**
re-runs the whole boot from a clean slate — a probed-once startup check aside, nothing from the
failed attempt is carried — and **Quit** ends the app.

The page's test ids are a contract held for `delivery/smoke/`: each row's `data-testid="boot-row"` with
`data-service` and `data-state` (main's raw values), and `boot-error`, `boot-log`, `boot-retry`.

## Why each peer is a plain env var

`database/` calls nobody, `auto/` calls nobody, `backend/` calls `database/`, `server/` calls all
three. Every peer is therefore knowable before the service that needs it starts, so a peer's URL is
just an env var at spawn — `DATABASE_URL`, `BACKEND_URL`, `AUTODL_URL`, the same names the services
read in dev. No `/peers` route, no peers file, no post-boot exchange. Main accumulates the URLs as
children come up and hands each new child everything already running; the ordering is what makes
that correct, and it survives only while the call graph stays acyclic (root `CLAUDE.md`).

## The port handshake

Main sets `FASTSTUDY_PORT=0` and matches each stdout line against `^FASTSTUDY_PORT=(\d+)$`; the
service side, including why the line comes only after `listen()`, is
[`lib/runtime`](../../lib/runtime/CLAUDE.md). Every other line on either stream is log output, and a
child that exits before reporting a port fails the boot with what it exited on.

`/health` is then polled until it answers — the one place the repo's push-over-poll preference does
not apply, since a booting child's only channel back to main is the port line it already sent.
`/health` is the one route exempt from the secret check, so the answer tells a wrong secret from a
dead child.

## The child environment

Every child gets `FASTSTUDY_PORT=0`, `FASTSTUDY_SECRET`, `FASTSTUDY_STATE_DIR`, the peers already
running, and the settings store's contents as the env vars each owning service reads (`DATA_ROOT`,
`GEMINI_MODEL`, `GDRIVE_ROOT_FOLDER`, `AUTO_RUN`, `DRIVE_ENABLED`, `GEMINI_API_KEY`,
`GROQ_API_KEY`). Packaged, it also gets `FASTSTUDY_BIN_DIR` and `TECTONIC_CACHE_DIR`.

The environment is read **once, at boot**. A settings change while the app runs reaches each service
through its own `POST /config`, which the renderer sends after the store write, so main never
re-spawns a child.

The state root is `.state/` at the repo root in dev and `%LOCALAPPDATA%\FastStudy` packaged, and it
is always passed explicitly rather than left to each service's fallback, so main's own log lands
beside the state the children write.

## Dev and packaged spawns

One `isPackaged` branch in the child spec table, and nothing else in the file knows the difference.

| Child      | Dev                              | Packaged                                     |
| ---------- | -------------------------------- | -------------------------------------------- |
| `database` | `uv run python database_main.py` | `resources/services/services database`       |
| `backend`  | `uv run python backend_main.py`  | `resources/services/services backend`        |
| `auto`     | `node app.js`                    | Electron's own exe, `ELECTRON_RUN_AS_NODE=1` |
| `server`   | `node src/index.js`              | Electron's own exe, `ELECTRON_RUN_AS_NODE=1` |

Each child's cwd branches with its command — its package in the repo tree in dev, its own staged
directory under `resources/` packaged. A cwd that does not exist fails the spawn outright, and in a
package the repo tree is not there: `__dirname` is inside `app.asar`.

Dev spawns the repo sources, which makes the whole launch path runnable without an installer.
Packaged, the Node services run on **Electron's own binary as node** because no other JS runtime
ships; it is also yt-dlp's player JS runtime, whose flags live in `server/`
([`DOWNLOAD.md`](../../downloader/server/docs/DOWNLOAD.md#the-js-runtime)).

The packaged tree main assumes, staged by the build as `electron`'s `extraResources`:

```
resources/services/services(.exe)   the PyInstaller one-dir bundle, service picked by argv[1]
resources/auto/app.js               the auto-downloader, run on Electron-as-node
resources/server/src/index.js       the download server, likewise
resources/frontend/                 the built frontend, served over app://bundle
resources/bin/                      ffmpeg, pandoc, tectonic, yt-dlp → FASTSTUDY_BIN_DIR
resources/latex/                    the primed tectonic cache → TECTONIC_CACHE_DIR
```

## Teardown

Children are spawned in their own process group (POSIX), so the kill reaches the tools they spawned
— ffmpeg, chrome, yt-dlp — and not just the service. Quit kills the group with `SIGTERM`; Windows
has no process groups, so it is `taskkill /T /F` there.

The kill runs from `will-quit`, `process.on('exit')`, `SIGINT`/`SIGTERM`, a failed boot before its
retry, and an uncaught exception, because an orphaned service keeps a port and keeps writing
`DATA_ROOT` after the app is gone, and the next launch would run a second backend against the same
`timing.db`. Only a `SIGKILL` of main escapes it.

The `will-quit` kill also has to stay where it is for a packaged update to install — see
[`UPDATES.md`](UPDATES.md).

## The log

Everything both streams of every child print, plus main's own boot lines, is written to
`<state root>/logs/launch.log`, each line tagged with the child that wrote it. It is truncated at
each launch: one launch's four children are the whole story a bug report needs, and appending would
grow without bound.

`<state root>/logs/` also holds the error reports ([`RENDERER.md`](RENDERER.md)), which are never
cleaned up: one is written only when a user asks, and its purpose is to still be there to attach.
