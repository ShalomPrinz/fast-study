# Updates

`updater.js` is the whole update surface: electron-updater against GitHub Releases on the public
`ShalomPrinz/fast-study`, one `latest` channel. Its configuration is the `publish` block in
`package.json`, which is also what writes `app-update.yml` into the package at build time.

## Silent by design

One check per launch, fired from `runBoot()` right after the window navigates to the frontend — not
before, so the check never competes with four service starts and never sits on the path that decides
whether the app comes up. A newer release downloads in the background and NSIS installs it the next
time the app quits. **Nothing reaches the screen**: no dialog, no notification, no bridge channel,
no launch-screen row.

That makes `launch.log` the feature's entire surface, which is why the updater logs through main's
`log('updater', ...)` rather than electron-updater's default `console`, which goes nowhere in a
package. A failed check is logged and dropped — an unreachable GitHub is the ordinary offline case.

The signal that would justify an in-app "update ready" banner is a user saying they had no idea an
update happened.

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
