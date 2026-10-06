# Updates

`updater.js` is the whole update surface: electron-updater against GitHub Releases on the public
`ShalomPrinz/fast-study`, one `latest` channel. Its configuration is the `publish` block in
`package.json`, which is also what writes `app-update.yml` into the package at build time.

## Silent on success, visible on the failure screen

One check per launch. On a successful boot it is fired from `runBoot()` right after the window
navigates to the frontend — not before, so the check never competes with four service starts and
never sits on the path that decides whether the app comes up. A newer release downloads in the
background and NSIS installs it the next time the app quits. **Nothing reaches the screen** then: no
dialog, no notification, no banner.

The one visible surface is the launch screen's failure view: a failed boot may be a bad install the
next release fixes, so `runBoot()`'s failure path calls `startUpdater(log, onPhase)` and publishes the
phase as `bootState.update`. `updatePhases.js` maps electron-updater's events to `checking`,
`downloading`, `none`, `downloaded` or `error` (a rejected check counts as `error`; a late error
never demotes `downloaded`). `boot.js` renders them in English:

| Phase         | Shown                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| `checking`    | spinner + "Checking for updates…"                                        |
| `downloading` | spinner + "Installing update…" (the download; NSIS runs when the app quits) |
| `none`        | "There is no update to install. Please contact us and report this issue." |
| `downloaded`  | check mark + green "Update complete. Please close the app and open it again." |
| `error`       | "Could not check for updates. Check your internet connection and try again; if it keeps failing, please contact us and report this issue." |

The `started` guard still makes it one check per launch: Try again and a second failure only attach
a listener and replay the current phase, never a second check or download. The listener ignores
phases once a retry has succeeded, so a launch that comes up stays silent. The row is hidden in dev,
where the updater no-ops.

`launch.log` carries the same story, through main's `log('updater', ...)` rather than
electron-updater's default `console`, which goes nowhere in a package. A failed check is logged and
dropped — an unreachable GitHub is the ordinary offline case.

The signal that would justify an in-app "update ready" banner on the success path is a user saying
they had no idea an update happened.

## Why the kill has to stay on `will-quit`

`autoInstallOnAppQuit` hooks `app.once('quit')`, which fires **after** `will-quit`, where main's
`killChildren()` runs — synchronously, so it completes before the handler returns. The installer
therefore starts only once all four services are dead and hold nothing under `resources/` open.
Moving the kill to a later hook would leave a service holding files NSIS is about to replace, and no
dev run would show it: dev does not update.

## The installer replaces `resources/` wholesale

Nothing that must survive an update lives there. Tectonic's `formats/` is a per-machine artifact the
next render rebuilds (~2s), and yt-dlp runs from its writable per-user copy under the state root so
it can update itself ([`DOWNLOAD.md`](../../downloader/server/docs/DOWNLOAD.md#the-writable-copy-and-its-self-update)).
Settings (`userData`) and the state root are both outside the install directory.

## Versions and publishing

The version is computed by `build.yml` and injected at build time
([`RELEASE.md`](../../delivery/docs/RELEASE.md#versions)); `app.getVersion()` reports it and
`launch.log`'s first line carries it. Nothing here publishes: a Release is only ever the installer
the smoke job tested ([`RELEASE.md`](../../delivery/docs/RELEASE.md#build-test-publish)).

The repo is public, so **no token ships with the app** — the updater needs only anonymous reads of
the Releases API and the asset.

## Not proven

The smoke suite proves the download and the quit-time install end to end, against a generic feed it
serves itself ([`SMOKE.md`](../../delivery/docs/SMOKE.md)). The GitHub provider — `app-update.yml`
finding a real Release — is exercised by nothing until the first Release is published.
