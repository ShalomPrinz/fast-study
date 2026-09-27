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

The preload script exposes exactly `{ urls, secret, settings, checks, version, locale, open, boot }` through `contextBridge`, in a sandboxed, context-isolated renderer.
`frontend/src/services/runtime.ts` is the consumer and fixes the shape; `urls` is
`{ backend, database, downloadServer, autoDownloader }`.

`version` is `app.getVersion()` rather than a Vite `define`, so it is what the installer put on
disk with no build-time coupling to `electron/package.json`. `locale` is `app.getLocale()`, the
frontend's initial language when the profile holds no pick ([`I18N.md`](../../frontend/docs/I18N.md)).

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
it is two calls:

- **`open.file({ course, lecture, name, kind })`** resolves the file through `database/`'s
  `/files/{name}/path` routes and hands the absolute path to `shell.openPath` — the user's own PDF
  app, not a Chromium tab. `lecture` absent addresses a course-level `overview/` file instead.
- **`open.external(url)`** opens an http(s) link in the user's browser. Any other scheme is refused:
  `shell.openExternal` launches whatever handler a scheme is registered to, so an unchecked one is a
  way to start a program from a renderer.

**The renderer sends identifiers, never a path.** `database/` stays the single owner of the
`{course}/{lecture}` layout, and a compromised renderer gets no open-any-file primitive out of the
bridge. Both answer `{ ok, error }` — main does not toast; the frontend does.

**Every `window.open` is denied** (`setWindowOpenHandler`). Electron would otherwise create the
child window itself with this window's security `webPreferences` — the preload, and so the launch
secret, on a third-party origin. Chromium routes `target="_blank"` here too, and each denial is
logged. Nothing guards navigation or checks an IPC sender, so the window must never leave
`boot.html` and `app://bundle`.

## Error reporting (Sentry)

Main inits `@sentry/electron/main` from `lib/sentry`'s policy (`options('electron')`), before
`registerScheme()` and before `ready`, which the SDK requires. The DSN is `FASTSTUDY_SENTRY_DSN` from
main's env, else `package.json`'s `sentryDsn`, which only the release build stamps
(`-c.extraMetadata.sentryDsn`); neither set means the SDK is never loaded: no DSN, no report.

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
the camelCase `Settings` shape — so the packaged app needs no adapter and browser dev keeps using
the database service's `.env` store unchanged. The renderer still sends its own `POST /config` calls
after a write, exactly as it does in dev; main does not, and stays out of the settings-owner rules
that `frontend/src/services/settings.ts` holds.

Main owns the store end to end, which is forced: `safeStorage` is a main-process API, and a store
written from both processes would put two writers on one file.

- **JSON under `app.getPath('userData')`**, with the field names the settings wire format uses, so
  the file reads like the settings screen rather than like a service's environment.
- **The two API keys are `safeStorage` ciphertext**, base64 in the same fields. DPAPI on Windows,
  the platform that ships.
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
- **In a packaged app `database/settings.py`'s `.env` store goes unused.** The services read the env
  vars main sets; nothing migrates between the two stores, and Electron never reads `.env`.
