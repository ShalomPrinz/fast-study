# Boot

## The sequence

1. `requestSingleInstanceLock()`. A second launch exits immediately and focuses the running window —
   two launchers would put two backends on one `timing.db` and two writers on one `DATA_ROOT`.
2. The `app://` scheme is registered as privileged **before** the app is ready; anything later is
   ignored and the scheme silently loses its origin. See [`RENDERER.md`](RENDERER.md).
3. One secret is generated for the launch: 32 random bytes, hex. It goes into every child's
   environment as `FASTSTUDY_SECRET` and reaches the renderer through the preload bridge.
4. The startup checks run, once, and are carried for the launch — see
   [`RENDERER.md`](RENDERER.md). They sit inline in the boot path, so each has to be cheap: no
   network, no spawn, no real disk work. Their duration is logged for exactly that reason, and a
   check reports a fact rather than deciding whether to launch.
5. The `BrowserWindow` is created and loads the launch screen, `boot.html` — see below.
6. The four children start **in dependency order** — `database → backend → auto → server` — one at a
   time. Each is spawned, its port read off stdout, and its `/health` waited on before the next
   starts.
7. All four healthy, the window navigates to `app://bundle/`. The frontend does not load before
   that: a renderer that loaded first would build its service clients at module scope against URLs
   that do not exist yet.

## The launch screen

`boot.html` and `boot.js`: one row per child, its state, and — once a child is up — anything its
`/health` tool probe could not run. It is a plain `file://` page rather than part of the frontend
bundle, for the same reason the window cannot open on the frontend: the bundle resolves the service
URLs at module scope and none of them exist while it renders. It is English only; the app's own
locale wiring does not reach it.

Main pushes the whole state on `faststudy:boot` at every change, and the page reads one snapshot
over `faststudy:boot-state` when it loads — the snapshot is what closes the race between the page's
first script and main's first push, which would otherwise reach a page with no listener.

A boot that fails anywhere **stays on the launch screen**, with the failure on the child that did not
come up, the message, and the path to the log. Everything that did start is killed first, so no row
still reads ready and a retry cannot leave a second copy of a service holding a port. **Try again**
re-runs the whole boot from a clean slate — a probed-once startup check aside, nothing from the
failed attempt is carried — and **Quit** ends the app.

## Why each peer is a plain env var

`database/` calls nobody, `auto/` calls nobody, `backend/` calls `database/`, `server/` calls all
three. Every peer is therefore knowable before the service that needs it starts, so a peer's URL is
just an env var at spawn — `DATABASE_URL`, `BACKEND_URL`, `AUTODL_URL`, the same names the services
read in dev. No `/peers` route, no peers file, no post-boot exchange. Main accumulates the URLs as
children come up and hands each new child everything already running; the ordering is what makes
that correct, and it survives only while the call graph stays acyclic (root `CLAUDE.md`).

## The port handshake

Each service binds `127.0.0.1:0` — main sets `FASTSTUDY_PORT=0` — and prints `FASTSTUDY_PORT=<n>`
alone on a line. Main reads stdout line by line and matches `^FASTSTUDY_PORT=(\d+)$`. Every service
listens _before_ printing, so connecting the instant the line arrives is safe.

Everything else on a child's stdout and stderr is log output. A child that exits before reporting a
port fails the boot with what it exited on.

`/health` is then polled until it answers. Polling is the only option here and the one place the
repo's push-over-poll preference does not apply: a booting child's single channel back to main is
the stdout line it has already sent, and `/health` is deliberately the one route exempt from the
secret check so the answer distinguishes a wrong secret from a dead child.

## The child environment

Every child gets `FASTSTUDY_PORT=0`, `FASTSTUDY_SECRET`, `FASTSTUDY_STATE_DIR`, the peers already
running, and the settings store's contents as the env vars each owning service reads (`DATA_ROOT`,
`GEMINI_MODEL`, `GDRIVE_ROOT_FOLDER`, `AUTO_RUN`, `DRIVE_ENABLED`, `GEMINI_API_KEY`,
`GROQ_API_KEY`). Packaged, it also gets `FASTSTUDY_BIN_DIR` and `TECTONIC_CACHE_DIR`.

The environment is read **once, at boot**. A settings change while the app runs reaches each service
through its own `POST /config`, which the renderer sends right after the store write — so nothing
needs a restart and main never has to re-spawn a child.

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

Dev spawns the repo sources, which is what makes the whole launch path runnable and testable without
an installer. The Node services run on **Electron's own binary as node** when packaged, because no
other JS runtime ships — and that is the same `process.execPath` yt-dlp is pointed at as its player
JS runtime (`downloader/server/docs/DOWNLOAD.md`). Main owes yt-dlp nothing beyond running the server
on that binary; the flags and `ELECTRON_RUN_AS_NODE` on its own spawn live in `server/`.

The packaged tree main assumes, staged by the build as `electron`'s `extraResources`:

```
resources/services/services(.exe)   the PyInstaller one-dir bundle, service picked by argv[1]
resources/auto/app.js               the auto-downloader, run on Electron-as-node
resources/server/src/index.js       the download server, likewise
resources/frontend/                 the built frontend, served over app://bundle
resources/bin/                      ffmpeg, ffprobe, pandoc, tectonic, yt-dlp → FASTSTUDY_BIN_DIR
resources/latex/                    the primed tectonic cache → TECTONIC_CACHE_DIR
```

## Teardown

Children are spawned in their own process group (POSIX), so the kill reaches the tools they spawned
— ffmpeg, chrome, yt-dlp — and not just the service. Quit kills the group with `SIGTERM`; Windows
has no process groups, so it is `taskkill /T /F` there.

The kill runs from `will-quit`, from `process.on('exit')`, from `SIGINT`/`SIGTERM`, from a failed
boot before its retry, and from an uncaught exception, because an orphaned service keeps a port and keeps writing `DATA_ROOT` after the
app is gone, and the next launch would then run a second backend against the same `timing.db`. The
one case none of that covers is main being `SIGKILL`ed, where the OS gives the process no chance to
run anything.

The `will-quit` kill also has to stay where it is for a packaged update to install — see
[`UPDATES.md`](UPDATES.md).

## The log

Everything both streams of every child print, plus main's own boot lines, is written to
`<state root>/logs/launch.log`, each line tagged with the child that wrote it. It is truncated at
each launch: one launch's four children are the whole story a bug report needs, and appending would
grow without bound over a machine's lifetime.

`<state root>/logs/` also holds the error reports the frontend's boundary mails —
`report-<timestamp>.txt`, one per send, each carrying the crash details and the log tail at that
moment ([`RENDERER.md`](RENDERER.md)). They are never truncated or cleaned up: a report is only
written when a user asks for one, and its whole purpose is to still be there to attach.
