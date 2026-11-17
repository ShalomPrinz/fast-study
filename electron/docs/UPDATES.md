# Updates

`updater.js` is the whole update surface: electron-updater against GitHub Releases on the public
`ShalomPrinz/fast-study`, one `latest` channel. Its configuration is the `publish` block in
`package.json`, which is also what writes `app-update.yml` into the package at build time.
`disableWebInstaller` makes it refuse web-installer packages, since the app ships only the full
`nsis` installer.

Windows and macOS share the check, the cadence, the phases and both surfaces below. The install
step differs — NSIS on Windows, [the app's own bundle swap](#the-macos-install-step) on macOS — and
so does its moment: Windows installs when the app quits, macOS
[at the next launch](#installing-at-the-next-launch).

## The sidebar row and the launch screen's failure view

One check at launch, then one every 30 minutes while the app stays open, so a release published
mid-session is already downloaded when the user closes it. The launch check is fired from `runBoot()`
right after the window navigates to the frontend — not before, so it never competes with four service
starts and never sits on the path that decides whether the app comes up. A newer release downloads in
the background and installs at once on Restart now; otherwise NSIS installs it the next time the
app quits, and macOS at the next launch.

Every check, rechecks included, feeds the app window through `window.faststudy.updates`: only
`downloading` and `downloaded` cross the bridge, everything else is `null`, and the frontend's
sidebar shows "Downloading update…" or "Restart now" from them. Main pushes each change on
`faststudy:update`, and `snapshot()` answers a listener that subscribed late. An unpackaged run never
starts the updater, so it stays `null`, and `packaged: false` tells the frontend so.

The recheck timer is `unref`'d, skips a tick while a check is still running or an update is downloading (a mid-download check
only blanks the window's row; the timer keeps running so a failed download is retried), and stops for good on
`update-downloaded` (another check could replace the pending installer). A failed recheck is logged
and dropped, as is a failed download: the `error` listener logs it and its `downloadPromise` rejection is caught, and once the first recheck runs the launch screen's phases freeze.

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

**Restart now kills first, then calls `quitAndInstall(false, true)`** — non-silent, because the
one-click NSIS progress window is the only thing on screen for the minute it spends replacing
`resources/`. Non-silent, electron-updater ignores the second arg; `autoRunAppAfterInstall` (left at
`true`) still passes `--force-run`, and a non-silent one-click install relaunches anyway. Unlike the
quit-time install, `quitAndInstall` spawns NSIS synchronously and only then calls `app.quit()`, so
`will-quit` would come too late. `restartToUpdate()` therefore awaits main's own `stopChildren()` —
the same kill, not a copy — before installing; the later `will-quit` finds no children and is a
no-op. It resolves with nothing (the app is quitting), or rejects with the failure text when nothing is
downloaded (nothing is killed), or when the kill throws or electron-updater reports a synchronous
install error, which is logged. Either of those puts the window back on the launch screen and re-runs
`runBoot()`; the page reloads, so the frontend may never see that answer. A failed installer launch
(EACCES, ENOENT, cancelled elevation) arrives only after the quit is scheduled, so the app quits
without updating and the user reopens it. The phase stays `downloaded`, so Restart now stays
offered, and the `started` guard keeps the reboot from starting a second updater.

## The macOS install step

electron-updater installs on macOS through Squirrel.Mac, which refuses a build whose code signature
differs from the running app's. The Mac build is ad-hoc signed, and no two ad-hoc builds match, so
`updater.js` turns `autoDownload` and `autoInstallOnAppQuit` off there and never calls
`downloadUpdate` or `quitAndInstall`. electron-updater still runs the check and parses
`latest-mac.yml`; `macUpdate.js` does the rest:

1. **Stage.** Skipped, as `update-not-available`, for a version whose
   [launch-time install](#installing-at-the-next-launch) already failed. Refused up front when the bundle's folder is not writable, so nothing is downloaded
   that could not be installed. The launch's offer to move into an Applications folder
   ([`BOOT.md`](BOOT.md#moving-into-applications)) leaves that to a user who declined it while
   running from the dmg or translocated by Gatekeeper, or whose app sits in `/Applications` under a
   non-admin account, where nothing is offered. Otherwise the feed's `.zip` streams to
   `<state root>/update/update.zip` over Electron's `net.fetch` (the system proxy, as the check
   uses), hashed as it arrives. A sha512 that is not the one `latest-mac.yml` gives deletes the file
   and fails; a match is unpacked with `ditto -x -k` into `<state root>/update/staged/`. The folder
   is cleared before each try and again when a try fails (download, hash, unpack, a zip with no
   `.app`); only an app killed mid-stage leaves a partial one, until the next try. Last of all the
   stage writes `<state root>/update/pending.json` — the version, the `.app`'s name and a sha256 over
   the unpacked tree — so a record always names a build that was verified and unpacked whole. A file
   the app wrote itself carries no `com.apple.quarantine`, so the swapped bundle does not meet
   Gatekeeper again.
2. **Report.** `updater.js` emits `update-downloaded` (or `error`) on electron-updater's own
   emitter, so the phases, the stopped timer, the retry on the next tick and the log line are the
   Windows ones.
3. **Install.** A detached `/bin/sh` helper, handed its script as `-c` text so nothing it runs lives
   in the bundle it replaces (positional args: `$1` pid, `$2` installed .app, `$3` staged .app,
   `$4` 0.2 s polls to wait for the pid, `$5` binary name, `$6` the app's own PATH; stdin is the
   handoff). It waits for main's pid to exit (a `kill -0` poll, five times a second
   for up to a minute: two unrelated processes share no channel to push on), moves the staged build
   to a hidden sibling `.FastStudy.app.new`, renames the installed bundle to `.FastStudy.app.old`,
   renames the new one into place and deletes the old one. If the last rename fails, the old bundle
   is renamed back; if that fails too, the log says the old build is left at `.FastStudy.app.old`
   and nothing is relaunched. The slow, possibly cross-volume move comes first, while the installed
   build is untouched. Every failure path deletes the staged build.
4. **Relaunch.** Every install ends in one. After a good swap the helper starts the new build's
   binary directly, [carrying the stored keys](#carrying-the-keys-across); after a failed swap it
   runs `open <bundle>`, which reopens the old build. A helper that gives up waiting never
   relaunches: the old app is still running, and `open` would only focus it.

The helper has two callers and no third. **Restart now** first verifies the staged tree against its
recorded digest and turns the record `attempted` — before the kill, so a mismatch fails the version,
logs it, answers `{error}` with the services still running and drops the Restart now button (the
state goes to `null`; no click could succeed). It then stops the services, registers
an `app.once('quit')` hook and calls `app.quit()`; the hook — after the `will-quit` kill, as on
Windows — starts the helper, and marks the version `failed` if that throws. A kill that throws writes the
record back to `pending`, so a retry click or the next launch can still install it. A failed swap reopens the
old build, which finds `attempted` and fails the version. The other caller is the next launch.

### Installing at the next launch

**A plain quit installs nothing on macOS.** A swap at quit leaves no running process to take the
keys, so the new build's first launch would meet the old build's Keychain item and stop on a system
prompt ([below](#carrying-the-keys-across)). The staged build waits instead, and the next launch of
the old build installs it with the handoff and relaunches: one slower launch, with one visible
restart.

`installPending()` runs in `whenReady` right after `adoptHandoff()` — before the move offer, the
scheme handler, the window and any spawn, so no service is alive and the `will-quit` kill has
nothing to order against. It reads `pending.json` and decides (`macPending.decide`):

| Record                                        | The launch                                                        |
| --------------------------------------------- | ----------------------------------------------------------------- |
| none                                          | boots, as on any other day                                        |
| unreadable, or no newer than the running build | deletes `update/` and boots — a stale stage, or the new build's own first launch |
| `pending`, newer                              | verifies, marks it `attempted`, starts the helper and quits       |
| `attempted`, newer                            | marks it `failed` and boots: a swap was started and this build is still the one here |
| `failed`, newer                               | boots; the updater does not download that version again           |

- **Verified against the recorded digest**, not the feed: the launch may be offline, and the zip the
  feed's sha512 covers was deleted after unpacking. The tree is hashed again — paths, modes, link
  targets, contents — so a staged build that lost or gained a file between the runs is not installed. No window opens
  while the tree hashes (only the Dock icon bounces) and the cost scales with disk speed; `verified in <n>ms`
  in `launch.log` is the figure to watch. Accepted over hashing only at staging or checking paths,
  modes and sizes: a tree damaged between runs would install a broken app the helper cannot roll back.
- **One try per version, from either caller.** A digest mismatch, a helper that cannot start and a swap that did not
  land all leave `{version, state: "failed", reason}` and nothing staged. The old build boots
  normally and skips that version at every check; the next release replaces the record.
- **The record turns `attempted` before the helper starts** (one shared verify-and-mark step), so the same build launched again — a
  second instance once the first has quit, the old build reopened after a failed swap — never starts
  a second swap. A second instance while the first still runs never gets this far: it exits on the
  single-instance lock.
- **It wins over the move into Applications.** The swap needs no answer and works where the bundle
  is — it was staged only because that folder is writable — while moving first would copy a build
  about to be replaced. The new build makes the offer on its own launch.
- **A bundle whose folder is not writable** (a second copy run from a dmg) leaves the record
  `pending` for the copy that staged it.
- **Nothing is drawn.** The old build quits before it creates a window; the user sees the Dock icon
  appear twice.

`launch.log` of the old build reads `[updater] version <v> verified in <n>ms — installing it before
this launch` then `install helper started (pid <n>) — it logs to …`, and that is its last line. The
other outcomes read `pending update cleared: <v> is not newer than this build`, `version <v> not
installed and not tried again: <reason>`, `version <v> did not install at the last launch and is not
tried again — see logs/update.log`, `version <v> stays pending: <folder> is not writable` and, from
the check, `version <v> is not downloaded again: <reason>`.

The helper writes `<state root>/logs/update.log`, truncated per install — not `launch.log`, which
the relaunch truncates. A good run reads, each line stamped `YYYY-MM-DD HH:MM:SS [update]`:

```
waiting for pid <n> to exit
pid <n> exited
swapping <bundle>
swapped: <bundle> is the new build
relaunching <bundle>
started <bundle>/Contents/MacOS/FastStudy with the handoff on fd 3
```

Failures read `gave up: pid <n> is still running, nothing swapped, not relaunching`,
or `swap failed: …`.
`launch.log` carries `install helper started (pid <n>)` from the launch that quit, unless the
relaunch has already truncated it.

### Carrying the keys across

The Keychain files an item made by non-Apple-signed code under the partition `cdhash:<build>`, so
every ad-hoc build is a stranger to the "FastStudy Safe Storage" item the previous one made, and its
first `safeStorage` call would stop on a system prompt. A self-signed certificate lands in the same
partition. So every install carries every `safeStorage` field — the two API keys and `token_key`,
without which `auto`'s Moodle token would be orphaned — from the old build to the new one in
memory, and the new build starts a Safe Storage item of its own:

1. **The old build** decrypts them as it starts the helper (`store.secrets()`) and writes one JSON
   object, `{"secrets": {…}}`, to the helper's stdin. Nothing stored is an empty object. A stored
   field that will not decrypt (a denied prompt, no key store) makes `secrets()` throw: the update
   then installs with no handoff, logging `installing without a key handoff, …`, and the new build
   deletes nothing and removes no field.
2. **The helper** holds that text in a shell variable. After a good swap it starts
   `Contents/MacOS/<binary>` itself, since `open` passes no descriptors on, with the text on a pipe
   mapped to fd 3 and `FASTSTUDY_HANDOFF_FD=3` naming it. The few hundred bytes fit the pipe buffer,
   so the write finishes at once and the helper exits right after starting the build; the pipe,
   not the helper, then holds the keys until the new build reads it or exits. The new build inherits the old app's environment, `PATH` included, so its
   services see what the old build's did; the helper's own tools stay pinned to `/usr/bin:/bin`.
3. **The new build** reads fd 3 to its end and closes it as `main.js` loads (`macHandoff.receive`),
   before the single-instance lock, any window or any spawn, and drops the variable so no child
   sees it. Once ready, before the first `safeStorage` call, `adoptHandoff()` first runs
   `store.checkAdoptable()` (the settings file parses and its folder is writable; nothing there
   touches the old item), then deletes every "FastStudy Safe Storage" item
   (`/usr/bin/security delete-generic-password`, one item per call, looped until none is left) and,
   only if every one is gone, `store.adopt()` re-encrypts the fields in one save, removing a
   ciphertext field the handoff did not carry. A failed or timed-out delete, or one that stopped at
   the limit, skips `adopt()` and leaves every stored field as it was.

Nothing reaches disk, the pasteboard, an argument or the environment: the helper's script uses no
heredoc, which `sh` backs with a temp file, and the only variable is the fd number.

- **The old item is deleted after the swap, by the new build**, so a failed swap reopens the old
  build with its item and its keys untouched. `macHandoff.deleteSafeStorage` is the one place it
  happens and `adoptHandoff()` its one caller.
- **A handoff that is empty, cut off or not JSON is not "no keys".** The helper falls back to
  `open` when its stdin was empty, and the new build leaves the item and the settings file alone
  when the pipe does not parse — the stored keys then cost the Keychain prompt rather than being lost.
- **The residual key loss.** `isEncryptionAvailable()` is not called before the delete, since it is
  not known to leave the Keychain alone on macOS. So if encrypting or saving fails after the old item
  is deleted, the plaintext is dropped and the stored keys cannot be read, and `auto`'s Moodle token is
  orphaned. Main then shows a one-button alert (awaited: the boot waits for OK, so the alert never
  sits behind the window) asking the user to re-enter the Gemini and Groq keys and sign in to Moodle
  again.
- **Every handoff failure reaches Sentry** (`receive`, `check`, `delete`, `adopt`): tags
  `handoff_step` and `handoff_keys_lost`, context `handoff` `{step, error, lost, fields}` where `fields`
  are the key names only. `adoptHandoff` returns that outcome; `main.js` does the alert and the report.
- **Until `adoptHandoff` returns**, the Sentry scrub skips the stored API keys: reading them
  decrypts, and a report raised mid-adopt would prompt for the old build's Keychain item. `DATA_ROOT` is still scrubbed.
- **The handoff relaunch steals focus** when its first window shows (`app.focus({ steal: true })`): the
  helper starts it from a background shell, which would otherwise open it behind other windows.
- **A launch with no `FASTSTUDY_HANDOFF_FD`** — a first run, a normal start, the relaunch after a
  move into Applications — reads nothing and deletes nothing.
- **Nothing installs without a relaunch**, since only a process the helper starts can take the
  keys — which is why macOS [defers a plain quit's install](#installing-at-the-next-launch).

`launch.log` of the relaunched build reads `handoff: deleted <n> "FastStudy Safe Storage" Keychain
item(s)` then `handoff: re-encrypted gemini_api_key, groq_api_key, token_key` (or `nothing — no key
was stored`). A blocked delete reads `…then the delete failed: timed out — a Keychain prompt is the
likely cause`, followed by `handoff not adopted: an old Keychain item may remain, the stored keys
are left as they were`; a bad pipe reads `handoff unreadable, the stored keys are left as they were: …`.

## The installer replaces `resources/` wholesale

Nothing that must survive an update lives there. Tectonic's prebuilt `formats/` ships in
`resources/latex/` beside `bundles/` and is replaced with the rest of `resources/` on every update, and yt-dlp runs from its writable per-user copy under the state root so
it can update itself ([`DOWNLOAD.md`](../../downloader/server/docs/DOWNLOAD.md#the-writable-copy-and-its-self-update)).
Settings (`userData`) and the state root are both outside the install directory. On macOS the whole
`.app` is replaced, under the same rule.

## Versions and publishing

The version is computed by `build.yml` and injected at build time
([`RELEASE.md`](../../delivery/docs/RELEASE.md#versions)); `app.getVersion()` reports it and
`launch.log`'s first line carries it. Nothing here publishes: a Release is only ever the installer
the smoke job tested ([`RELEASE.md`](../../delivery/docs/RELEASE.md#build-test-publish)).

The repo is public, so **no token ships with the app** — the updater needs only anonymous reads of
the Releases API and the asset.

## Not proven

The smoke suite proves the download and the quit-time install end to end, against a generic feed it
serves itself ([`SMOKE.md`](../../delivery/docs/SMOKE.md)). No one on the team has a Mac: the macOS
install step is proven by `tests/macUpdate.test.js` (the sha512 check and the helper's ordering,
rollback, give-up and handoff, against real `sh`), `tests/macHandoff.test.js`, `tests/macPending.test.js`
and the launch decision in `tests/updater.test.js`, and otherwise only by the macOS CI job. Only
that job can show how long the tree digest takes on a real bundle, that nothing alters a staged
build between two runs, that an old build quitting before its first window relaunches cleanly, that the delete raises no Keychain prompt, that the new
build's first `safeStorage` call makes a fresh item unprompted, and that a binary started directly
is a normal foreground app — Dock icon, activation on `show()`, the single-instance lock. The GitHub provider — `app-update.yml`
finding a real Release — is exercised by nothing until the first Release is published.
