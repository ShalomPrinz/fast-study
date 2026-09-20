# Services

Each file under `src/services/` is the **single boundary** for one external concern; no call site touches
`fetch`, `EventSource` or `react-toastify` directly. A feature owns a service only when the concern is its
alone (`features/downloads/services/`).

## `http.ts` — client factory

`createClient(baseUrl, serviceName)` centralizes `!res.ok → throw`, JSON and headers, including
`X-FastStudy-Secret`; `url(path)` gives URLs the page loads itself (pdf.js, `open.ts`'s dev fallback).

A failure's message is the body's `{error}` — the one failure shape every service sends — falling back to
the status line, which says nothing useful to the settings screens. `423` is the exception: the database
service sends it when another program (usually the user's PDF viewer) holds the file, and its English
prose is written for pipeline run errors, so a user's own delete gets a localized message here instead.
It does not name the file, which would have to be parsed back out of the URL.

**Connection errors are handled once, here.** Only a network failure rejects as a `TypeError` (aborts are
`DOMException` and pass through), so that branch wraps it in `ConnectionError`, toasts it keyed by base
URL — a downed service shows one toast, not a stack — and rethrows. Call sites add no connection handling
of their own; they ignore the throw or check `isConnectionError`. `shared/utils/failure.ts`'s
`toastFailure` is that check plus the toast, for the call sites that report a refused request themselves.

## `backend.ts` → FastAPI (:8000)

Pipeline triggers, runner status, timing stats and the course-overview endpoints. The wire is
`snake_case`; camelCase normalization happens here and nowhere else.

## `database.ts` → database service (:8001)

Everything filesystem-backed. `materialUrl`/`deleteMaterial` take a runtime name, since a material's name
comes from the tree rather than the fixed `FileName` set. `uploadVideo` announces the arrival to the
backend (`reportVideoArrived`) itself, because auto-run is backend policy and a caller that only stored
the bytes would lose it; a failed report is logged, never rethrown, since the bytes are stored.

## `runtime.ts` — the Electron preload bridge

The one file declaring `window.faststudy` (a second `declare global` would not compile), read through
`runtimeBridge()`, which is `undefined` outside Electron and under vitest. Its import of `SettingsBacking`
is type-only, so the mutual import with `settings.ts` is erased.

- **Base URLs** — the four services from `urls` on the bridge, else the dev ports; resolved synchronously
  at import, since every client is built at module scope and packaged ports are chosen at boot.
- **Launch secret** — `secretHeaders()` for requests; `withSecretParam(url)` only for the two
  `EventSource`s, which cannot set a header. The header keeps the secret out of access logs. Both add
  nothing in browser dev, where no service enforces a secret.
- **`open` and `report`** — non-optional: the whole bridge's absence is the browser-dev test.
- **`canStoreApiKeys`** ([SETTINGS.md](SETTINGS.md)), the installed `version`, and the OS `locale`
  ([I18N.md](I18N.md)).

## `open.ts` — opening a file or a link outside the app

Packaged, a fresh navigation cannot carry `X-FastStudy-Secret`, so a service URL opened in a new window
is a `401` and a blank page. `openLectureFile`, `openOverviewFile` and `openExternalUrl` hand
**identifiers** to `window.faststudy.open`, which resolves the path through `database/` and opens it in
the user's own app — a path never reaches the renderer, so a compromised one gets no open-any-file
primitive. A failure toasts its English prose inside a translated wrapper.

A link keeps its `href` for hover and copy but calls `openExternalUrl` with `preventDefault()`: the shell
denies every `window.open`, so `target="_blank"` does nothing, and a bare `href` would load the site in the
app window, where the preload is still exposed. Without the bridge (browser dev) it is a plain
`window.open`. It is its own file because it needs both `runtime.ts` and `database.ts`.

## `settings.ts`, `drive.ts`, `report.ts`

`settings.ts` spans three services on purpose — a setting's owner is a property of the setting, not the
screen — and `drive.ts` is apart from it because `app/DriveConsentPrompt` calls it outside the settings
screens. Both are covered in [SETTINGS.md](SETTINGS.md). `report.ts` hands the error boundary's crash
report to the bridge ([ARCHITECTURE.md](ARCHITECTURE.md) §Error boundary) and never toasts.

## `events.ts` and `toaster.ts`

`events.ts` is a module-level singleton over `${databaseUrl}/events`, opened on the first subscriber and
closed on the last, consumed only through `useNotify`.

`toaster.ts` is the one `react-toastify` import (its CSS too) and hosts every toast shape — new shapes get
a helper here. `ToastContainer` is mounted in `App` above the init gate, since a toast with no mounted
container is queued, not shown. `toastInitResult` only reports `'busy'` — `'started'` arrives over SSE and
a refused run rejects, which the caller reports with `toastFailure`.
Every toast dismisses on a click; `toastPromise` re-states `closeOnClick` because a loading toast opts out.

## URL building — `shared/utils/url.ts`

Hebrew names must be percent-encoded: use the ` path` `` tag, which encodes every interpolation, and never
`encodeURIComponent` at a call site. Its output is encoded, so **never feed `path` (or `lectureBase`) back
into another `path`**. The browser route is `/{course}/{lecture}` (`lectureRoute`), the API path
`/courses/{course}/lectures/{lecture}` (`lectureBase`); `kindQuery` appends `?kind=recitation` to either.

## `features/downloads/services/autoDownloader.ts` → auto-downloader (:3053)

Discovery and auth. An `Item`'s `ref` is opaque — round-trip it, never parse it. `/list` and `/list/expand`
go through `postReconnectAware`, a bespoke `fetch` because the shared client discards the body and these
encode meaning in it:

| HTTP | body                  | thrown                                                                    |
| ---- | --------------------- | ------------------------------------------------------------------------- |
| 401  | `status: reconnect`   | `ReconnectError` — steer to the account chip                              |
| 422  | `status: unsupported` | `UnsupportedError` — permanent; `message` is display-ready                |
| 409  | `status: passcode`    | `PasscodeError` — zoom gate; `reason: missing \| incorrect`               |
| 503  | `status: blocked`     | `BlockedError` — bot-protection challenge; transient, carries no message |

The trade-off is no central `ConnectionError` wrapping: a refused connection is a raw `TypeError`.
`BlockedError` drops the body's `message`, an English log line. `PasscodeError` maps `name` to `lecture`
because `name` collides with `Error.name`. The helper takes a `Client` because the downloader server's
`/download-item` forwards the same four bodies verbatim.

## `features/downloads/services/downloadServer.ts` → downloader server (:3052)

Downloads, jobs and section runs. `downloadItem` and `startSectionRun` return what the page needs — the
resolved `media`, the `renames`. `subscribeJobs` and `subscribeRuns` each wrap `GET /events` (`job:change`
/ `run:change`, `open` also calling back for resync) — two connections, the price of keeping the two
reflections independent. `fetchJobs`/`fetchRuns` bypass the shared client, because it toasts every
`ConnectionError` and a reconnect loop would stack one per attempt; they add the secret header by hand.
User actions (`startSectionRun`, `resumeRun`, `cancelRun`) use the client, since a user action against a
downed server _should_ toast. See [JOBS.md](JOBS.md) and [BULK.md](BULK.md).
