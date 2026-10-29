# The renderer: scheme, bridge, store

## `app://bundle`

The window loads `app://bundle/` once all four services are healthy — the launch screen is what it
shows until then ([`BOOT.md`](BOOT.md)) — served out of `frontend/dist` in dev and
`resources/frontend/` packaged.

**The window opens on the site root, never on `/index.html`.** The frontend routes on the URL path,
and `/index.html` is not one of its routes: the bundle would load, mount, and render an empty page
for anyone past the first-run wall — which renders whatever the route is, and so hides the mistake
until the app is actually configured.

- **Registered before `app.whenReady()`**, as `standard: true, secure: true`. Registration after
  ready is ignored, and `secure` without `standard` leaves every request from the page carrying
  `Origin: null`, which no service allowlist can match.
- **The host is the frozen literal `bundle`.** All four services hardcode `app://bundle` in their
  CORS allowlist, and a page there sends it host-only, with no trailing slash, on every CORS request
  including the preflight. Electron's permission-handler API reports the same origin **with** a
  trailing slash — deriving the allowlist from it would reject everything — so nothing here computes
  the origin from an API.
- **Anything that is not a built file gets `index.html`.** The frontend routes with `BrowserRouter`,
  so `app://bundle/courses/X/lectures/Y` has to resolve to the SPA rather than 404. The join is
  containment-checked against the bundle root first: an encoded slash (`..%2f`) survives the URL
  parser's own normalization, so the check is on the resolved path, not on the request.

`frontend/vite.config.ts` sets no `base`, so built asset URLs are absolute `/assets/...` and resolve
to `app://bundle/assets/...` from any route depth.

## `window.faststudy`

The preload script exposes exactly `{ urls, secret, settings, checks, version, locale, defaultDataRoot, errorReports, packaged, platform, updates, power, open, pickFolder, extension, boot }` through `contextBridge.executeInMainWorld`, in a sandboxed, context-isolated renderer.
`frontend/src/services/runtime.ts` is the consumer and fixes the shape; `urls` is
`{ backend, database, downloadServer, autoDownloader }`.

`version` is `app.getVersion()` rather than a Vite `define`, so it is what the installer put on
disk with no build-time coupling to `electron/package.json`. `locale` is `app.getLocale()`, the
frontend's initial language when the profile holds no pick ([`I18N.md`](../../frontend/docs/I18N.md)).
`defaultDataRoot` is `data` under the state root (`%LOCALAPPDATA%\FastStudy\data` packaged,
`.state/data` in dev) — only the init wall's prefill: main creates nothing, the database does on save.
`errorReports` is the stored switch as the page loaded, `false` when unset; after a save, the write's
result is current ([error reporting](#error-reporting-sentry)).

`packaged` is `app.isPackaged`; `updates` is the sidebar's update row —
`snapshot()`, `subscribe(callback)` (returns its unsubscribe) and `restart()` ([`UPDATES.md`](UPDATES.md)).

`power` is `{ subscribe(callback) }`, returning its unsubscribe: `powerMonitor`'s `'suspend'` and
`'resume'` pushed on `faststudy:power`, so the frontend can hold the connection toasts Chromium's
failed in-flight requests would raise across sleep. Push only — a page loaded after waking needs no state.

`extension` is `{ path, reveal() }`: the folder Chrome loads the extension unpacked from (the
state-root copy packaged, the repo's `downloader/extension` in dev) and opening it in the file manager
([`EXTENSION.md`](EXTENSION.md)).

`boot` belongs to the launch screen alone, which loads in the same window and so through the same
preload. The frontend ignores it, and the launch screen ignores everything else — while it renders
`urls` is still empty, since no service has a port yet.

`urls` and `secret` are fetched over a **synchronous** IPC message, because the frontend resolves
them at module scope and the bridge has to be complete before the bundle evaluates. They travel over
IPC rather than through `additionalArguments` so the launch secret never appears on a command line,
where every other process on the machine could read it.

## Opening files and links

A service URL handed to a fresh browser navigation cannot carry the `X-FastStudy-Secret` header, so
in the packaged app every such navigation is a `401` and a blank window. `open` is the way out, and
it is four calls. A data-file target takes one of four shapes, each resolved by `dataFiles.js`
through its `database/` `…/path` route: lecture `{ course, lecture, name, kind }`, assignment
`{ course, assignment, name }`, assignment-generated `{ course, assignment, generated }` (an AI-generated
file, `…/generated/{name}/path`), and overview `{ course, name }` (a course-level `overview/` file).
A `generated` target that also names `name`, or names no `assignment`, is refused before any lookup.

- **`open.file(target)`** hands the resolved path to `shell.openPath` — the user's own app, not a
  Chromium tab.
- **`open.fileWith(target)`** opens Windows' "Open with" chooser on it (`%SystemRoot%\System32\OpenWith.exe
  <path>`, argv, no shell; `rundll32 shell32.dll,OpenAs_RunDLL` starts but shows no window on current
  Windows 11). Off Windows it rejects with message `unsupported`
  without asking the database; the frontend offers it only when `platform` is `win32`.
- **`open.reveal(target)`** selects it in the OS file manager (`shell.showItemInFolder`), on every
  platform. That call reports nothing, so a resolved path is success.
- **`open.external(url)`** opens an http(s) link in the user's browser. Any other scheme is refused:
  `shell.openExternal` launches whatever handler a scheme is registered to, so an unchecked one is a
  way to start a program from a renderer.

**The renderer sends identifiers, never a path.** `database/` stays the single owner of the
`{course}/{lecture}` layout, and a compromised renderer gets no open-any-file primitive out of the
bridge. Each resolves with nothing on success and rejects with an `Error` whose `message` is the exact
OS, spawn or fetch text, `database answered <status>`, `the database service is not running`,
`unsupported`, `invalid target`, `not a URL: <url>` or `refused scheme: <proto>:`; main does not toast, the frontend does. Main's handler answers `undefined` or `{ error, code? }` and never throws — Electron prefixes a
thrown message with "Error invoking remote method …". A database 404 on the path route is the one
failure with a `code`, `file_not_found` (the database's own); every other failure is code-less.

**The rejection is built in the page's world.** The context bridge copies only `message` and `stack`
of an `Error` thrown across it, so a `code` set in the preload would vanish. The preload hands its
API to `contextBridge.executeInMainWorld`, whose serialised function defines the frozen
`window.faststudy` and wraps `open.*` and `updates.restart` to turn `{ error, code? }` into
`Object.assign(new Error(error), { code })`. That function closes over nothing.

**`pickFolder(defaultPath?)`** opens the OS folder dialog — for the data-folder field and for the general
downloads folder the extension asks for — and resolves to the chosen absolute path, or `null` on cancel.
It restores, shows and focuses the window first (topmost for an instant, past Windows' focus-stealing
rule), since an extension-triggered pick finds it behind Chrome or minimized. It is the one path the
renderer gets back from main, and main neither creates nor validates it — the folder is only a proposal
until the service that owns it accepts it.

**Every `window.open` is denied** (`setWindowOpenHandler`). Electron would otherwise create the
child window itself with this window's security `webPreferences` — the preload, and so the launch
secret, on a third-party origin. Chromium routes `target="_blank"` here too, and each denial is
logged. Nothing guards navigation or checks an IPC sender, so the window must never leave
`boot.html` and `app://bundle`.

## Error reporting (Sentry)

Main inits `@sentry/electron/main` from `lib/sentry`'s policy (`options('electron')`), before
`registerScheme()` and before `ready`, which the SDK requires. The DSN is `FASTSTUDY_SENTRY_DSN` from
main's env, else `package.json`'s `sentryDsn`, which only the release build stamps
(`-c.extraMetadata.sentryDsn`); neither set means the SDK is never loaded: no DSN, no report. The
environment is `production` packaged, else `development`: one constant, also every child's `SENTRY_ENVIRONMENT`.

**The user's switch is live, and off until answered.** The store's `error_reports` (`errorReports`)
is on only when it is `true` — unset is off, so nothing leaves before the first-run screen is
answered. With a DSN, main inits the SDK either way and off is `lib/sentry`'s transport gate
(`transport: makeElectronOfflineTransport(gate(makeElectronTransport))`), set from the store before
the init: a second `init()` throws in `@sentry/electron` main, so the SDK is never closed, re-inited
or toggled through `enabled`. The gate sits under the offline queue because that queue re-sends
envelopes saved by an earlier launch ~5s after init, past the client's own checks; while off it
drains them unsent. Every child gets the DSN plus `FASTSTUDY_ERROR_REPORTS` ([`BOOT.md`](BOOT.md#the-child-environment)).

A `settings.write` carrying `errorReports` flips main's flag, then POSTs `{"error_reports": bool}`
with the secret to all four services' `/config` in parallel, 2s each. A service that is down, slow or
refuses never fails the save: the result carries `errorReportsRestartNeeded: true` (and the log
names the service), and the frontend tells the user the switch is whole only after a restart, when
the child env carries it. Writes are serialised, so two quick toggles land in order. The renderer's
own SDK holds its own flag; its events still reach Sentry only through main, so main's gate and
`beforeSend` cover them either way.

**A renderer's event travels renderer SDK → IPC → main → Sentry.** The SDK registers its own preload
on the default session (`registerPreloadScript`); it requires only `electron`, so it runs in the
sandbox where `preload.js` could not `require` it, and exposes `window.__SENTRY_IPC__` beside
`window.faststudy`. `ipcMode` is `Classic`: the `sentry-ipc://` fallback would register a second
privileged scheme through a wrapper around `registerSchemesAsPrivileged`, tying `app://`'s
privileges to call order. The renderer sends over IPC, not `fetch`, so no CSP `connect-src` is involved.

**Main's `beforeSend` sees every event, a renderer's included**, and does three things:

- **Tags.** The SDK copies a renderer's scope tags onto main's scope, so main re-tags any event not
  from a renderer `service=electron`; a renderer event keeps the `service=frontend` it arrived with.
- **Scrubs** with the policy's `scrub`, after putting the launch secret and the stored `DATA_ROOT`
  and API keys on `process.env` for the synchronous call — the policy reads only env, and main holds
  those elsewhere. A renderer, which has neither, gets its `DATA_ROOT` paths redacted here.
- **Attaches** the tail of `launch.log` (the last 200KB) as `launch.log`, run through the same scrub
  first — it carries every child's output, Hebrew paths included.

Minidumps are off (`SentryMinidump` filtered out): raw process memory is past any scrub. An
attachment a renderer adds rides through unscrubbed, so the frontend adds none. On an uncaught
exception main kills the children, then flushes (2s) before exiting, or the event would be lost.

## Startup checks

`checks` carries the machine-level facts the app degrades on, probed once at boot by `checks.js` and
delivered on the same synchronous IPC as `urls` and `secret`. Today it is one field,
`secureStorage: boolean`.

A check is a fact, not a verdict: nothing here fails a launch. `secureStorage: false` means the two
API-key fields on the settings screens are disabled and say why, while every other setting saves
normally — and the two keys stop counting as required entries, or the init wall would be a wall
nobody on that machine could ever pass.

**The renderer's default when there is no bridge is `true`, deliberately.** No bridge is browser
dev, which has no Electron store at all and saves keys through `database/`'s `.env` store, so a
missing bridge must never render as an unsupported machine. Why each check must be cheap is in
[`BOOT.md`](BOOT.md).

## The settings store

`settings` implements the frontend's `SettingsBacking` — `read()` and `write(patch)`, both answering
the camelCase `Settings` shape, `write` adding `errorReportsRestartNeeded` — so the packaged app
needs no adapter and browser dev keeps using the database service's `.env` store unchanged. The
renderer still sends its own `POST /config` calls after a write, exactly as it does in dev; main
sends only the error-reports switch's, and stays out of the settings-owner rules that
`frontend/src/services/settings.ts` holds.

Main owns the store end to end, which is forced: `safeStorage` is a main-process API, and a store
written from both processes would put two writers on one file.

- **JSON under `app.getPath('userData')`**, with the field names the settings wire format uses, so
  the file reads like the settings screen rather than like a service's environment.
- **The two API keys are `safeStorage` ciphertext**, base64 in the same fields. DPAPI on Windows,
  the platform that ships.
- **`token_key` is the same ciphertext, a launcher-made key for `auto`'s token file** — never in `read()`, never to the renderer; see [`BOOT.md`](BOOT.md#the-child-environment).
- **A stored key never travels to the renderer.** `read()` reports `geminiApiKeySet` /
  `groqApiKeySet` booleans, and nothing else ever returns the value.
- **Keys are decrypted into each child's environment at spawn**, never onto a command line.
- **A machine with no key store refuses the write.** `safeStorage.isEncryptionAvailable()` is false
  on a Linux box without a keyring — WSL, for instance — where the only alternative Electron offers
  is its explicit plaintext mode. Refusing is the honest answer: saving a key through the app is a
  dev-only loss there, since dev services still read the repo-root `.env`, and the platform that
  ships always has DPAPI. The throw is the backstop, not the user-facing message — the `secureStorage`
  check is what the screens read, so a key never reaches a save that would be refused.
- **A patch that cannot be applied in full is not applied at all.** Every field is converted before
  anything is written, so a refused key does not leave the data root beside it half-saved. The
  renderer adopts `write()`'s return value as its state and sends its `POST /config` calls only
  after it resolves, so a partial write would leave the file, the running services and the screen
  each holding a different answer. `database/settings.py` builds its updates the same way.
- **A refused patch resolves, never throws, as `{ code, params, message }`** — no `ok` field, since
  the view never has a `code` key. IPC strips an Error's own properties, and so does the context
  bridge, so the preload rejects `settings.write` with that plain object rather than an `Error`.
  Codes and params (`field` = the camelCase patch key) are `database/settings.py`'s for the same
  refusals: `unknown_setting`, `setting_must_be_{string,boolean,integer}`, `setting_invalid_choice`
  (+`value`), plus the launcher's `setting_out_of_range` (+`min`, `max`). The keystore refusal still throws.
- **Integer fields (`INT_FIELDS`, `{ env, min, max }`) refuse a write outside their range**, and an
  out-of-range stored value reads `null` and stays out of the env.
- **A stored key the store no longer knows is inert**: neither the read view nor the env lists it.
- **`gemini_auto_fallback` (`geminiAutoFallback`)** reaches the backend as `GEMINI_AUTO_FALLBACK`
  (`true`/`false`); unset reads `null`, which the backend treats as off.
- **`auto_retry` (`autoRetry`, bool), `auto_retry_count` (`autoRetryCount`, 1–10) and
  `auto_retry_minutes` (`autoRetryMinutes`, 1–120)** reach the backend as `AUTO_RETRY`,
  `AUTO_RETRY_COUNT` and `AUTO_RETRY_MINUTES`; unset reads `null` and the backend's defaults apply.
- **`error_reports` and `privacy_confirmed` are the launcher's own fields**, in no service's settings
  env. Main turns `error_reports` into each process's Sentry flag itself; `privacy_confirmed`
  (`privacyConfirmed`, unset reads `false`) is the renderer's record that the privacy notice was
  answered, and main only stores it.
- **`ai_provider` (`aiProvider`) is launcher-only too**: `claude` | `chatgpt` | `gemini`, any other
  write refused; unset or unknown reads `null` and the renderer applies the `claude` default.
- **`auto_remove` (`autoRemove`: `off` | `video` | `audio`) and `auto_remove_after`
  (`autoRemoveAfter`: `pdf` | `drive`) are choices like `auto_run`**: lowercased, any other write
  refused, and — as `database/settings.py` reads them — unset or unknown reads `null` and stays out
  of the env as `AUTO_REMOVE` / `AUTO_REMOVE_AFTER`. `course_structure` (`courseStructure`:
  `split` | `lectures_all` | `lectures_some`) follows the same rule as `COURSE_STRUCTURE`.
- **In a packaged app `database/settings.py`'s `.env` store goes unused.** The services read the env
  vars main sets; nothing migrates between the two stores, and Electron never reads `.env`.
