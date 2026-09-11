# Updates

`updater.js` is the whole update surface: electron-updater against GitHub Releases on the public
`ShalomPrinz/fast-study`, one `latest` channel. Its configuration is the `publish` block in
`package.json`, which is also what writes `app-update.yml` into the package at build time.

## Silent by design

One check per launch, fired from `runBoot()` right after the window navigates to the frontend — not
before, so the check never competes with four service starts and never sits on the path that decides
whether the app comes up. If there is a newer release it downloads in the background and NSIS
installs it the next time the app quits. **Nothing reaches the screen**: no dialog, no notification,
no bridge channel, no launch-screen row. The user starts the app one day and it is newer.

That makes `launch.log` the entire user-visible surface of the feature, which is why the updater
logs through main's own `log('updater', ...)` rather than electron-updater's default `console`,
which goes nowhere in a package. A check that fails is logged and dropped — an unreachable GitHub is
the ordinary offline case, not a fault.

The signal that would justify an in-app "update ready" banner is a user saying they had no idea an
update happened. Until then the silence is the point.

## Why the kill has to stay on `will-quit`

`autoInstallOnAppQuit` hooks `app.once('quit')`, which fires **after** `will-quit`, where main's
`killChildren()` runs — synchronously, so it completes before the handler returns. The installer
therefore starts only once all four services are dead and no longer hold anything under
`resources/` open. Moving the kill to a later hook would leave a running service holding the files
NSIS is about to replace, and no dev run would ever show it: dev does not update.

## The installer replaces `resources/` wholesale

Nothing that must survive an update lives there. Tectonic's `formats/` is a per-machine artifact the
next render simply rebuilds (~2s), and yt-dlp is meant to run from a writable per-user copy under
`%LOCALAPPDATA%` rather than out of `resources/bin/`, so it can update itself. Settings
(`userData`) and the state root are both outside the install directory and are untouched.

## Versions and the channel

The version is `electron/package.json`'s `version`, bumped in a commit before a release is built.
`app.getVersion()` reports it and `launch.log`'s first line already carries it, so the log says which
build produced it. The channel is `latest`, and `releaseType: "release"` publishes straight to a live
Release rather than to electron-builder's default draft.

The repo is public, so **no token ships with the app** — the updater only needs anonymous reads of
the Releases API and the asset. A token is needed to *publish* (`npm run release`, which is
`--publish always`), never to consume.

## Not proven

electron-updater has never run against a real Release: no installer has been built yet, so nothing
here has been observed end to end. The first release is what confirms that `app-update.yml` lands in
the package, that the check finds the Release, and that the quit-time install actually replaces a
running installation. Treat every claim above as the intended design until then.
