# The browser extension: shipped folder and native host

The downloader's extension ships inside the app and is loaded unpacked by the user in Chrome or Edge. A packaged
server listens on an ephemeral port behind a per-launch secret, so the extension learns both through a
native messaging host named `com.faststudy.bridge`. `extension.js` holds all of it; main calls
it at launch, once `server` is up, and on teardown.

## The extension folder

`resources/extension/` is the shipped copy, and the browser loads `<state root>/extension`. A load-unpacked
extension is bound to its folder path, and every update replaces `resources/` wholesale, so the
copy keeps one path across updates and reinstalls. On each packaged launch, main replaces the copy whole
when its `manifest.json` `version` differs from the shipped one, or is missing. The new copy is
staged as `extension.new` and the old one is renamed away before the swap, so a locked file fails cleanly
instead of leaving half a folder. A failure is logged and never fails the boot. In dev nothing is copied,
and the path is the repo's `downloader/extension`.

`window.faststudy.extension` is `{ path, reveal() }`: `path` is that folder, and `reveal()` opens it
with `shell.openPath`. `reveal()` always resolves, and a failure goes to the log.

## The bridge file

`<state root>/bridge.json` is `{ "port": <server port>, "secret": "<FASTSTUDY_SECRET>",
"extensionVersion": "<shipped manifest version>" }`. Main writes it once `server` is healthy,
through a tmp file and a rename, so the host never reads half of it. `killChildren()` removes it, so it
goes on every exit path and before a failed boot's retry. A `server` that dies on its own removes it
too, so the host answers `{ "running": false }` rather than a dead port. `boot()` also removes it on entry, in case
the last launch crashed. It is written in dev too, where no host is registered to read it.
The extension reloads itself when `extensionVersion` differs from its own manifest's.

**Security.** The file puts the launch secret on disk in the user's state directory, readable by that
user's processes. Those processes can already read the app's environment, and with it
`FASTSTUDY_SECRET`, so this is the same trust boundary. On POSIX the file is created `0600`. Its
contents are never logged, and the launch log records only its path. The Sentry scrub already redacts
the secret by value.

## The native host

`bridge/host.js` ships as `resources/bridge/host.js`. It reads one framed request (a 4-byte
little-endian length, then UTF-8 JSON) and ignores its content. It answers with the bridge file's
JSON, or `{ "running": false }` when the file is missing or unreadable, then exits. It answers as soon
as a whole frame arrives, because the browser keeps stdin open until the host exits. The bridge file's path
is its `argv[2]`. The host gets no `FASTSTUDY_STATE_DIR`, since the browser starts it, not main.

Registration runs on every packaged Windows and macOS launch. Both write the same host manifest —
`name`, `description`, `path` (the file the browser runs), `type: "stdio"`, and `allowed_origins:
["chrome-extension://hknnjgdhokbapjodjklfodhobjekjlnn/"]`, whose trailing slash is required. Edge
loads the extension under the same `key`-pinned ID, so the same `chrome-extension://` origin matches.

### Windows

It writes into `<state root>/native-host/`:

- `host.bat`: `@echo off`, then `set ELECTRON_RUN_AS_NODE=1`, then one line that runs `FastStudy.exe` on
  `host.js` with the bridge file's path. Nothing may echo, because stdout is the framed channel. Each path
  is quoted. Its longest `%LOCALAPPDATA%`, `%APPDATA%` or `%USERPROFILE%` prefix is written as the
  variable, since cmd reads `.bat` bytes in the console codepage and a non-ASCII user name would not
  survive. A literal `%` is doubled. The file lives in the state root because it carries absolute
  paths, and `resources/` is replaced by updates.
- `com.faststudy.bridge.json`, the host manifest, whose `path` is the `.bat`.
- `reg add <key> /ve /t REG_SZ /d <manifest path> /f` for each browser's key, both pointing at that one
  manifest: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.faststudy.bridge` and
  `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.faststudy.bridge`. Each write runs
  through `child_process` with no native module and logs its own line naming the browser, and one
  failing never skips the other.

Both files are rewritten only when their content changed, because cmd reads a running `.bat` line by
line. Every step is idempotent, and a failure is one log line that never fails the boot. The
per-user install means HKCU needs no admin. `assets/installer.nsh`'s `customUnInstall` deletes both
browsers' keys on uninstall but not on an update, which runs the old uninstaller first. The state-root
files stay behind, but with no key neither browser finds them.

### macOS

There is no registry: each browser reads the manifest out of its own per-user folder.

- `<state root>/native-host/host.sh`, mode `755`: `#!/bin/sh`, then one line that `exec`s the app
  binary (`FastStudy.app/Contents/MacOS/FastStudy`) with `ELECTRON_RUN_AS_NODE=1` on `host.js` and
  the bridge file's path. Each path is one single-quoted word, and the origin argument the browser
  appends is dropped. It lives in the state root for the same reason the `.bat` does.
- `com.faststudy.bridge.json`, whose `path` is that script, written to both
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` and
  `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/`. The folder is created when
  missing, so a browser installed later finds it. Each write logs its own line naming the browser,
  and one failing never skips the other.

The script and both manifests are rewritten only when their content changed. Nothing removes the
manifests when the app is dragged to the Trash; they then name a script whose `exec` fails, and the
extension reads that as the app not running.
