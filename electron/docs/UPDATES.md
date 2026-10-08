# Updates

`updater.js` is the whole update surface: electron-updater against GitHub Releases on the public
`ShalomPrinz/fast-study`, one `latest` channel. Its configuration is the `publish` block in
`package.json`, which is also what writes `app-update.yml` into the package at build time.
`disableWebInstaller` makes it refuse web-installer packages, since the app ships only the full
`nsis` installer.

## The sidebar row and the launch screen's failure view

One check at launch, then one every 4 hours while the app stays open, so a release published
mid-session is already downloaded when the user closes it. The launch check is fired from `runBoot()`
right after the window navigates to the frontend — not before, so it never competes with four service
starts and never sits on the path that decides whether the app comes up. A newer release downloads in
the background and NSIS installs it the next time the app quits, or at once on Restart now.

Every check, rechecks included, feeds the app window through `window.faststudy.updates`: only
`downloading` and `downloaded` cross the bridge, everything else is `null`, and the frontend's
sidebar shows "Downloading update…" or "Restart now" from them. Main pushes each change on
`faststudy:update`, and `snapshot()` answers a listener that subscribed late. An unpackaged run never
starts the updater, so it stays `null`, and `packaged: false` tells the frontend so.

The recheck timer is `unref`'d, skips a tick while a check is still running, and stops for good on
`update-downloaded` (another check could replace the pending installer). A failed recheck is logged
and dropped, and once the first recheck runs the launch screen's phases freeze.

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
| `error`       | "Could not check for updates. Check your internet connection, then close and reopen the app. If it keeps failing, please contact us and report this issue." |

The `started` guard makes the updater start once per launch: Try again and a second failure only
attach a listener and replay the current phase, never a second timer, check or download. The listener ignores
phases once a retry has succeeded, so a launch that comes up shows only the sidebar row. The row is hidden in dev,
where the updater no-ops.

`launch.log` carries the same story, through main's `log('updater', ...)` rather than
electron-updater's default `console`, which goes nowhere in a package. A failed check is logged and
dropped — an unreachable GitHub is the ordinary offline case.

## Why the kill has to stay on `will-quit`

`autoInstallOnAppQuit` hooks `app.once('quit')`, which fires **after** `will-quit`, where main's
`killChildren()` runs — synchronously, so it completes before the handler returns. The installer
therefore starts only once all four services are dead and hold nothing under `resources/` open.
Moving the kill to a later hook would leave a service holding files NSIS is about to replace, and no
dev run would show it: dev does not update.

**Restart now kills first, then calls `quitAndInstall(true, true)`** (silent, relaunch). Unlike the
quit-time install, `quitAndInstall` spawns NSIS synchronously and only then calls `app.quit()`, so
`will-quit` would come too late. `restartToUpdate()` therefore awaits main's own `stopChildren()` —
the same kill, not a copy — before installing; the later `will-quit` finds no children and is a
no-op. It answers `{ ok: true }` (the app is quitting), or `{ ok: false, error }` when nothing is
downloaded (nothing is killed), or when the kill throws or electron-updater reports a synchronous
install error, which is logged. Either of those puts the window back on the launch screen and re-runs
`runBoot()`; the page reloads, so the frontend may never see that answer. A failed installer launch
(EACCES, ENOENT, cancelled elevation) arrives only after the quit is scheduled, so the app quits
without updating and the user reopens it. The phase stays `downloaded`, so Restart now stays
offered, and the `started` guard keeps the reboot from starting a second updater.

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
