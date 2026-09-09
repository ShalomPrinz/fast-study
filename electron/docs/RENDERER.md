# The renderer: scheme, bridge, store

## `app://bundle`

The window loads `app://bundle/index.html`, served out of `frontend/dist` in dev and
`resources/frontend/` packaged.

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
  containment-checked against the bundle root first: `%2e%2e` survives the URL parser's own
  normalization, so the check is on the resolved path, not on the request.

`frontend/vite.config.ts` sets no `base`, so built asset URLs are absolute `/assets/...` and resolve
to `app://bundle/assets/...` from any route depth.

## `window.faststudy`

The preload script exposes exactly `{ urls, secret, settings }` through `contextBridge`, in a
sandboxed, context-isolated renderer. `frontend/src/services/runtime.ts` is the consumer and fixes
the shape; `urls` is `{ backend, database, downloadServer, autoDownloader }`.

`urls` and `secret` are fetched over a **synchronous** IPC message, because the frontend resolves
them at module scope and the bridge has to be complete before the bundle evaluates. They travel over
IPC rather than through `additionalArguments` so the launch secret never appears on a command line,
where every other process on the machine could read it.

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
