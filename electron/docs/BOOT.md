# Boot

## The sequence

1. `requestSingleInstanceLock()`. A second launch exits immediately and focuses the running window —
   two launchers would put two backends on one `timing.db` and two writers on one `DATA_ROOT`.
2. The `app://` scheme is registered as privileged **before** the app is ready; anything later is
   ignored and the scheme silently loses its origin. See [`RENDERER.md`](RENDERER.md).
3. One secret is generated for the launch: 32 random bytes, hex. It goes into every child's
   environment as `FASTSTUDY_SECRET` and reaches the renderer through the preload bridge.
4. Packaged on macOS, an app outside an Applications folder offers to move itself there — see
   [Moving into Applications](#moving-into-applications). On a yes this launch quits here, before
   anything is served, registered or spawned, and the moved copy boots instead.
5. The startup checks run once and are carried for the launch ([`RENDERER.md`](RENDERER.md)). They
   sit inline in the boot path, so each has to be cheap — no network, no spawn, no real disk work —
   and their duration is logged to catch one that stops being so.
6. Packaged, the extension's stable copy is refreshed and, on Windows and macOS, the native host is registered
   — both logged, neither able to fail the boot ([`EXTENSION.md`](EXTENSION.md)).
7. The `BrowserWindow` is created and loads the launch screen, `boot.html` — see below. It opens
   centred at the last launch's normal size, maximized if it closed maximized; the size is fitted to
   the work area and the minimum, and saved on `close` and in the `exit` handler a signal still runs.
   It lives in its own `window-state.json`, so it never enters the settings store's read view or env.
8. The four children start **in dependency order** on two tracks: `database → backend`, and `auto`
   alongside them because it calls no peer. `server` starts once all three are healthy. Each child is
   spawned, its port read off stdout, and its `/health` waited on before anything that needs it
   starts. The first failure on either track fails the boot, and the other track spawns nothing
   more. Once `server` is healthy, main writes `bridge.json` for the native host.
9. All four healthy, the window navigates to `app://bundle/`. The frontend does not load before
   that: a renderer that loaded first would build its service clients at module scope against URLs
   that do not exist yet. The load is not awaited; when it finishes main logs `[main] app loaded
   app://bundle/` (or `app load failed app://bundle/: <reason>`), which `delivery/smoke/` times boot by.
10. Main then sends `auto` a fire-and-forget `POST /warmup`, so Playwright loads in the background
   rather than on the user's first browser action; its result is one log line and a failure surfaces
   nowhere, since `auto` loads on demand anyway.

## Moving into Applications

The macOS update swaps the bundle in place, which needs a writable folder around it
([`UPDATES.md`](UPDATES.md#the-macos-install-step)); a dmg mount and a Gatekeeper-translocated path
are read-only. So a packaged macOS launch whose bundle is under neither `/Applications` nor
`~/Applications` asks, in English like the launch screen and with no parent window:

> **Move FastStudy to Applications?** FastStudy can only update itself from an Applications folder.
> It will be moved to `<folder>` and reopened. — _Move to Applications_ / _Not Now_

- **The target** is `/Applications` when this user can write it, else `~/Applications`, created on
  the yes. Nothing asks for an admin password.
- **Paths are compared resolved.** `process.execPath` is a real path while the home folder may be a
  symlink, so both Applications folders are resolved before the test. A target that is the running
  bundle itself is never asked about: replacing it with its own copy would end with the copy in the Trash.
- **A yes** copies the bundle with `ditto --noqtn` to a hidden sibling of the target, renames it into
  place over any copy already there, starts a detached `/bin/sh` helper, moves the original to the
  Trash (a dmg or translocated original refuses, which is logged) and quits. A failure at any point
  leaves an installed copy as it was.
- **The helper** waits for main's pid to exit — a `kill -0` poll, five a second for up to a minute —
  then runs `open <target>`. Opened sooner, the new copy would lose the single-instance lock and exit.
- **`--noqtn` is load-bearing.** A copy that kept `com.apple.quarantine` and was not moved by the
  Finder is translocated when opened, so it would land outside Applications and ask again.
- **A copy running from the target** — another account's, since the lock rules out this user's — is
  not replaced: a second alert says so (_FastStudy was not moved_) and the boot goes on.
- **A no, or any failure,** is one `launch.log` line and the boot continues from where the app is.
  Nothing is remembered, so the next launch asks again.

The native host needs no step of its own: the moved copy's boot rewrites `host.sh` with its own
executable path ([`EXTENSION.md`](EXTENSION.md)). Electron's `app.moveToApplicationsFolder` is not
used: it asks for an admin password when `/Applications` is not writable and never targets
`~/Applications`.

## The launch screen

`boot.html` and `boot.js`: one row per child and its state. A boot either succeeds or fails; a tool
a service cannot run is not a boot outcome and never shows here — it reaches the user as an in-app
toast, which the frontend raises off each service's `GET /tools` once the window is open. It is a
plain `file://` page rather than part of the frontend bundle, for the same reason the window cannot
open on the frontend: the bundle resolves the service URLs at module scope and none of them exist
while it renders. It is English only: the frontend's locale wiring does not reach it.

Main pushes the whole state on `faststudy:boot` at every change, and the page reads one snapshot
over `faststudy:boot-state` when it loads — which closes the race with main's first push reaching a
page that has no listener yet.

A boot that fails anywhere **stays on the launch screen**, with the failure on the child that did not
come up, the message, and the path to the log. Everything that did start is killed first, so no row
still reads ready and a retry cannot leave a second copy of a service holding a port. **Try again**
re-runs the whole boot from a clean slate — a probed-once startup check aside, nothing from the
failed attempt is carried — and **Quit** ends the app.

A spawn that fails — whether Node emits `'error'` or throws synchronously, as it does for `UNKNOWN` —
takes the same path. Packaged on Windows, a binary under `resources/` failing with `ENOENT`,
`UNKNOWN`, `EPERM` or `EACCES` is almost always antivirus quarantining or still scanning the unsigned
`faststudy-services.exe`, so the message names that and the restore-from-Protection-history fix instead of the
raw error, which stays in the log. Like the rest of the page it is English and carries no error code:
nothing would resolve one ([ERROR-CODES.md](../../docs/ERROR-CODES.md)).

On the failure view only, one more row reports the update check main starts then — a spinner while
checking or downloading, then the outcome ([`UPDATES.md`](UPDATES.md)). It rides `bootState.update`
(`null` until the first phase); a successful boot never shows it. Try again does not restart the check.

The page's test ids are a contract held for `delivery/smoke/`: each row's `data-testid="boot-row"` with
`data-service` and `data-state` (main's raw values), and `boot-error`, `boot-log`, `boot-update` (with `data-phase`), `boot-retry`.

## A service that dies after the boot

A child that exits while still listed died on its own — every kill main sends unlists the child first.
Main unlists it and, on POSIX, `SIGKILL`s what its process group still holds (chrome under `auto`,
ffmpeg under `backend`). Windows has no process group and `taskkill /T` walks the tree from a live
pid only; a `taskkill` on the dead pid is never sent, since Windows may already have reused it for an
unrelated process. There `backend` kills its own tree through its kill-on-close job — only the Drive
consent browser leaves it ([PIPELINE.md](../../backend/docs/PIPELINE.md#execution-model)). A dead Node
service's descendants run on until they end by themselves, an accepted gap: `server`'s `yt-dlp`/`curl`
finish their current download and exit, and `auto`'s Chromium should exit when its control pipe
closes (unconfirmed on Windows).

While a boot runs, that exit fails the boot onto the failure view above, whether or not the port line
had arrived — the app never loads with a service already dead. After the boot, main removes
`bridge.json` if it was `server`, logs `<name> stopped unexpectedly`, adds the name to the set of
services stopped since the last successful boot, and pushes it on `faststudy:service-stopped`. The set
is the snapshot a page loading or reloading after the push reads (`faststudy:services-stopped`); a
successful boot or restart empties it. Main respawns nothing on its own: the frontend's banner offers
Restart and the user decides.

Restart (`faststudy:services-restart`) runs the boot again inside the same `booting` guard, so a
second click or a Try again while it runs is ignored: it shows the launch screen, stops every child, then boots all four —
all, since each respawn gets a new port and a surviving peer's env var would still name the old one.
Success navigates back to `app://bundle/`, whose reload re-runs the preload and so reads the new URLs;
a failure lands on the failure view above. The launch secret is kept: it lives for the process.

## Why each peer is a plain env var

`database/` calls nobody, `auto/` calls nobody, `backend/` calls `database/`, `server/` calls all
three. Every peer is therefore knowable before the service that needs it starts, so a peer's URL is
just an env var at spawn — `DATABASE_URL`, `BACKEND_URL`, `AUTODL_URL`, the same names the services
read in dev. No `/peers` route, no peers file, no post-boot exchange. Each child gets exactly the
peers it calls — `backend` gets `DATABASE_URL`, `server` all three, `database` and `auto` none — so
nothing waits on a service it never calls. That survives only while the call graph stays acyclic
(root `CLAUDE.md`).

## The port handshake

Main sets `FASTSTUDY_PORT=0` and matches each stdout line against `^FASTSTUDY_PORT=(\d+)$`; the
service side, including why the line comes only after `listen()`, is
[`lib/runtime`](../../lib/runtime/CLAUDE.md). Every other line on either stream is log output, and a
child that exits before reporting a port fails the boot with what it exited on.

`/health` is then polled until it answers, as liveness only — its body is not read — the one place the repo's push-over-poll preference does
not apply, since a booting child's only channel back to main is the port line it already sent.
`/health` is the one route exempt from the secret check, so the answer tells a wrong secret from a
dead child.

## The child environment

Every child gets `FASTSTUDY_PORT=0`, `FASTSTUDY_SECRET`, `FASTSTUDY_STATE_DIR`, `FASTSTUDY_VERSION`
(`app.getVersion()`, each Sentry init's release), `SENTRY_ENVIRONMENT` (`production` packaged, else
`development`, main's own too), `FASTSTUDY_SENTRY_DSN` (main's resolved DSN, empty when there is none),
`FASTSTUDY_ERROR_REPORTS` (`1` when the stored switch is on, else `0` — never absent, so a value in
main's own env is not inherited past the switch),
the peers it calls, and the settings store's contents as the env vars each owning service reads (`DATA_ROOT`,
`GEMINI_MODEL`, `GDRIVE_ROOT_FOLDER`, `AUTO_RUN`, `AUTO_REMOVE`, `AUTO_REMOVE_AFTER`, `COURSE_STRUCTURE`, `MOODLE_SITE`, `DRIVE_ENABLED`, `GEMINI_API_KEY`,
`GROQ_API_KEY`). Packaged, it also gets `FASTSTUDY_BIN_DIR` and `TECTONIC_CACHE_DIR`.

`auto` alone also gets `FASTSTUDY_TOKEN_KEY`, the 32-byte key it encrypts its Moodle token with
(standard base64). It is generated once and held as `safeStorage` ciphertext in the settings file's
`token_key`; one that no longer decrypts is regenerated, orphaning the token it protected. With no key
store, `auto` is spawned without the var and stores the token unencrypted — `launch.log` says so,
and never carries the key.

The child env is built from the launcher's own, so a `FASTSTUDY_TOKEN_KEY` already set in the launching shell
reaches all four services; only `auto` reads it and the launcher's generated key overrides it there. Dev-only: a
packaged launch has no such shell variable.

The environment is read from the store **at each boot**, a Try again included. A settings change
while the app runs reaches each service through its own `POST /config` — the renderer sends those
after the store write, except the error-reports switch, which main sends itself
([`RENDERER.md`](RENDERER.md#error-reporting-sentry)) — so main never re-spawns a child.

The state root is `.state/` at the repo root in dev, `%LOCALAPPDATA%\FastStudy` packaged on Windows
and `~/Library/Application Support/FastStudy` packaged on macOS — `userData` itself there, which is
already named for the app, so settings and state share one folder. It is always passed explicitly rather than left to each service's fallback, so main's own log lands
beside the state the children write.

## Dev and packaged spawns

One `isPackaged` branch in the child spec table, and nothing else in the file knows the difference.

| Child      | Dev                              | Packaged                                     |
| ---------- | -------------------------------- | -------------------------------------------- |
| `database` | `uv run python database_main.py` | `resources/services/faststudy-services database` |
| `backend`  | `uv run python backend_main.py`  | `resources/services/faststudy-services backend`  |
| `auto`     | `node app.js`                    | Electron's own exe, `ELECTRON_RUN_AS_NODE=1` |
| `server`   | `node src/index.js`              | Electron's own exe, `ELECTRON_RUN_AS_NODE=1` |

Each child's cwd branches with its command — its package in the repo tree in dev, its own staged
directory under `resources/` packaged (`resources/downloader/<dir>` for the Node services, as in the repo). A cwd that does not exist fails the spawn outright, and in a
package the repo tree is not there: `__dirname` is inside `app.asar`.

Dev spawns the repo sources, which makes the whole launch path runnable without an installer.
Packaged, the Node services run on **Electron's own binary as node** because no other JS runtime
ships; it is also yt-dlp's player JS runtime, whose flags live in `server/`
([`DOWNLOAD.md`](../../downloader/server/docs/DOWNLOAD.md#the-js-runtime)).

The packaged tree main assumes, staged by the build as `electron`'s `extraResources`. `resources/`
is `process.resourcesPath`: beside the exe on Windows, `FastStudy.app/Contents/Resources/` on macOS.

```
resources/services/faststudy-services(.exe)  the PyInstaller one-dir bundle, service picked by argv[1]
resources/downloader/auto/app.js    the auto-downloader, run on Electron-as-node
resources/downloader/server/src/index.js  the download server, likewise
resources/downloader/node_modules/  the workspace's one hoisted node_modules — not `resources/node_modules`, which `app.asar` would resolve into
resources/frontend/                 the built frontend, served over app://bundle
resources/bin/                      ffmpeg, pandoc, tectonic, yt-dlp → FASTSTUDY_BIN_DIR
resources/latex/                    the primed tectonic cache → TECTONIC_CACHE_DIR
resources/extension/                the Chrome extension, copied to <state root>/extension
resources/bridge/host.js            the native host script, run on Electron-as-node by a generated .bat (Windows) or .sh (macOS)
```

The bundle is never named `services.exe`: that is the image name of Windows' Service Control Manager,
and `taskkill` refuses to end any process carrying it, whatever its path.

## The installed process tree

Main is the install-dir `FastStudy.exe` that the four services are direct children of. Lacking
`--type=` does not single it out: `auto` and `server` are also `FastStudy.exe` run as Node
(`ELECTRON_RUN_AS_NODE=1`) without one, as are yt-dlp's JS runtime and the native host. Under a
Playwright launch `app.process().pid` is main's parent, not main, so find main as the services'
shared parent.

## Teardown

Children are spawned in their own process group (POSIX), so the kill reaches the tools they spawned
— ffmpeg, chrome, yt-dlp — and not just the service. Quit sends the group `SIGTERM`, then `SIGKILL`
after a 3s grace (longer than a service's ~2s Sentry flush) to any child still alive, and main waits
for that before it exits, or the timer would die with it. Windows has no process groups, so it is
`taskkill /T /F` there, and a non-zero taskkill exit is logged with its output. `process.on('exit')` cannot wait, so it only sends the `SIGTERM`. The same
kill removes `bridge.json`, so the native host answers `{ "running": false }` once the services are gone.

The kill runs from `will-quit`, `process.on('exit')`, `SIGINT`/`SIGTERM`, a failed boot before its
retry, and an uncaught exception, because an orphaned service keeps a port and keeps writing
`DATA_ROOT` after the app is gone, and the next launch would run a second backend against the same
`timing.db`. Only a `SIGKILL` of main escapes it.

The `will-quit` kill also has to stay where it is for a packaged update to install — see
[`UPDATES.md`](UPDATES.md).

## The log

Everything both streams of every child print, plus main's own boot lines, is written to
`<state root>/logs/launch.log`, each line stamped with the local date and time and tagged with the
child that wrote it — `2026-10-08 12:04:31.207 [auto] ...`. It is truncated at
each launch: one launch's four children are the whole story a bug report needs, and appending would
grow without bound.

Its scrubbed tail rides on every Sentry event main sends ([`RENDERER.md`](RENDERER.md#error-reporting-sentry)).
