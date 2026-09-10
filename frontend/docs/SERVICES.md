# Services

Each file under `src/services/` is the **single boundary** for one external concern. Components and hooks
go through them — no call site touches `fetch`, `EventSource` or `react-toastify` directly.

## `http.ts` — client factory

`createClient(baseUrl, serviceName)` centralizes `!res.ok → throw`, JSON encoding and headers — including
the `X-FastStudy-Secret` launch secret on every request — and exposes
`url(path)` for the URLs the page loads itself — pdf.js's own fetch, and `open.ts`'s browser-dev fallback. URL string building lives in `shared/utils/url.ts`, not here.

A failed response's message comes from its body — `{error}`, FastAPI's `{detail}`, or `{message}`, whichever is
there — falling back to the status line. "400 Bad Request" says nothing about a data root that turned out not
to be writable, and that prose is what the settings screens show.

`423` is the one status whose body is replaced rather than shown: the database service answers it when
another program holds the file open — a native pdf viewer left on `summary.pdf`, since the app opens pdfs
in the user's own app — and its English prose is written for the pipeline's run errors, where nothing
localizes it. A delete the user made themselves gets a localized message here instead, so every call site
that already surfaces a rejection surfaces this one. It deliberately does not name the file: the name would
have to come from the request URL, and the toast lands on the click that caused it.

**Connection errors are handled once, here.** Per the Fetch spec only a network failure rejects as a
`TypeError` (aborts are `DOMException` and propagate untouched), so that branch wraps the error in a typed
`ConnectionError` carrying the friendly service name, toasts it, and rethrows. `toastConnectionError` keys
the toast by base URL, so a downed service reuses one toast instead of stacking. Call sites must not add
their own connection-error handling; they either ignore the throw or check `isConnectionError` before
showing a second message.

## `backend.ts` → FastAPI (:8000)

Pipeline triggers (`runStep`, `runPipeline`, `runAll`, `reportVideoArrived`), `fetchRunnerStatus`, `fetchTimingStats`, and the
course-overview endpoints (`fetchOverviewExtractors`, `runOverview`, `fetchCourseStatus`). The wire format
is `snake_case`; normalization to camelCase happens here and nowhere else, so `types.ts` shapes stay clean.

## `database.ts` → database service (:8001)

Everything filesystem-backed: tree, course/lecture CRUD, summary read/save/revert, video upload, file URLs,
course `overview/` file listing + meta. `materialUrl`/`deleteMaterial` hit the same per-file routes as
`fileUrl`/`deleteFile` but take a runtime name, since a material's name comes from the tree rather than the
fixed `FileName` set. Also exports `databaseUrl`, the base the SSE `EventSource` is built
from. `fetchCourseMeta` unwraps `{ meta }` and renames `generated_at` → `generatedAt`.

`uploadVideo` announces the arrival to the backend itself (`reportVideoArrived`) once the `PUT` resolves —
auto-run is backend policy, and a caller that only stored the bytes would silently lose it. Like the settings
boundary below, this concern spans both services by design. A failed report is logged, never rethrown: the
bytes are stored, so failing the upload would be a lie.

## `runtime.ts` — the Electron preload bridge

The one file that declares `window.faststudy`, exposed through `runtimeBridge()` (`undefined` outside
Electron, and under vitest's `node` environment). A second `declare global` for the same property would not
compile, so anything the preload exposes is declared here; its import of `SettingsBacking` is type-only, so
the mutual import with `settings.ts` is erased and there is no runtime cycle.

It also owns the launch secret. `secretHeaders()` returns the `X-FastStudy-Secret` header, spreadable into
any request; `withSecretParam(url)` appends `?secret=…` and is used **only** by the two `EventSource` calls,
which cannot set a header and reconnect on their own. Both return nothing extra when the bridge carries no
secret — browser dev, where the services see no `FASTSTUDY_SECRET` and enforce nothing. The header keeps the
secret out of access logs and the devtools URL column, so nothing else uses the query parameter.

`open` is the bridge's file/link opener, consumed only by `open.ts` below. It is the one member declared
non-optional: the whole bridge's absence is the browser-dev test, so a present bridge always carries it.

It also resolves the four service base URLs — `BACKEND_URL`, `DATABASE_URL`, `DOWNLOAD_SERVER_URL`,
`AUTO_DOWNLOADER_URL` — from `urls` on the bridge, falling back to the dev ports. Resolution is
synchronous at import time because every service builds its client at module scope; the packaged app's
ports are chosen at boot, so nothing here may be baked in at build time and the frontend reads no env var.

## `open.ts` — opening a file or a link outside the app

`openLectureFile(course, lecture, name, kind?)` (summary.pdf and materials alike), `openOverviewFile(course,
name)` and `openExternalUrl(url)`. In the packaged app a fresh browser navigation cannot set
`X-FastStudy-Secret`, so a service URL opened that way is a `401` and a blank window: these hand
**identifiers** to `window.faststudy.open`, which resolves the path through `database/` and opens the file in
the user's own PDF app. A path never reaches the renderer, so a compromised one gets no open-any-file
primitive. A failed `{ ok: false, error }` toasts through `toaster.ts`; `error` is English prose from the OS
or the database service, shown inside a translated wrapper.

**The absence of the bridge is the browser-dev test**, and that branch is a plain `window.open(url, '_blank')`
against the URL builders in `database.ts` — dev has no secret to be missing. It needs both `runtime.ts` and
`database.ts`, which is why it is its own boundary: `runtime.ts` cannot import `database.ts`.

## `settings.ts` — the settings store, the two config owners and the prerequisite probes

The boundary for the settings concern, which spans three services on purpose: a setting's owner is a
property of the setting, not of the screen editing it, and the two prerequisites the settings screens
check are owned the same way. Exports `Settings` (the read view, `null` for anything unstored — the
client owns every default), `SettingsPatch` (partial; omitted fields are left alone), `fetchSettings`,
`saveSettings`, `fetchConfigOptions`, `probeKey` and `fetchBrowserPrereq`.

**The two API keys are write-only.** `SettingsPatch` carries `geminiApiKey`/`groqApiKey`; `Settings`
reports only `geminiApiKeySet`/`groqApiKeySet`, so a stored key never travels back to the renderer.

`SettingsBacking` is the read/write seam over the store, and `pickBacking()` is the only place the two
backings are chosen between — the Electron preload bridge on `window.faststudy.settings` when the app is
packaged, the database service's `GET`/`PUT /settings` in browser dev. The bridge exposes the same
interface, so there is no adapter. Both backings are permanent: browser-only dev stays a first-class loop
after Electron lands.

`saveSettings` is **two phases, in order**: the store is written first, since it is what a fresh boot reads
back, then each changed field is pushed to its one owner's `POST /config` — `backend/` for the keys, model,
Drive toggle, Drive folder and auto-run, `database/` for `data_root`. Nothing restarts. Every field
the store holds has an owner; the UI language is not among them — it never leaves the browser
profile's `localStorage`.

`probeKey(provider, key)` answers `valid` / `rejected` / `unverified`; every failure short of a verdict
folds to `unverified`, because an unreachable provider must never report a good key as bad.

`fetchBrowserPrereq()` is the other prerequisite, `GET /prereqs/browser` on the auto-downloader:
`{ available, channel, browser, detail }`, always `200`, since "no browser" is an answer and not a
failure. It lives here rather than in the downloads feature because the settings screens are its only
caller and no feature imports another's service. See [SETTINGS.md](SETTINGS.md).

## `drive.ts` — linking a Google account to Drive

`fetchDriveStatus()`, `connectDrive()` and `disconnectDrive()` over the backend's `/config/drive/*`.
It is a boundary of its own rather than part of `settings.ts` because it has a caller outside the
settings screens: `app/DriveConsentPrompt` asks for consent wherever the user is. `DriveStatus` is
`{ connected, pending, consentNeeded }`, always answered — none of the three is a failure.
`connectDrive` returns the URL the backend has **already** opened a browser on, so the URL is only a
"didn't open?" fallback, and it throws the error envelope's prose when `credentials.json` is missing.
See [SETTINGS.md](SETTINGS.md).

## `events.ts` — the database notify stream

Module-level singleton over `${databaseUrl}/events`, opened on the first `subscribeNotify` and closed when
the last subscriber unsubscribes. Consumed only through `useNotify`. The downloads page opens a second,
unrelated stream against the downloader server; that one lives in its own service, below.

## `toaster.ts` — the one `react-toastify` import

Exports `toast(kind, message)`, `toastConnectionError`, `toastPromise` (lifecycle toasts for fire-and-track
work like video upload), `toastInitResult`, and re-exports `ToastContainer` (mounted once in `Layout`; the
toastify CSS is imported here too). `toastInitResult` folds a `RunInitResult` into a toast and deliberately
does nothing on `'started'` — completion arrives over SSE. New toast shapes get a helper here.

Every toast dismisses on a click anywhere in its body: `Layout` sets `closeOnClick` on the container, and
`toastPromise` re-states it because a `loading` (pending) toast opts out by default.

## URL building — `shared/utils/url.ts`

Hebrew course/lecture/file names must be percent-encoded. Never call `encodeURIComponent` at a call site;
use the ` path` `` tagged template, which encodes every interpolated value and leaves literals alone.

Its output is already encoded, so **never feed `path` output (or `lectureBase`, built from it) back into
another `path`** — that double-encodes.

Note the asymmetry: the browser route for a lecture is `/{course}/{lecture}` (`lectureRoute`) while the API
path is `/courses/{course}/lectures/{lecture}` (`lectureBase`). `kindQuery` appends `?kind=recitation` to
both; lectures carry no suffix. `overviewGenerateQuery` composes the overview trigger's optional
`extractors` CSV + `from_phase` + `skip_existing`.

## `features/downloads/services/autoDownloader.ts` → auto-downloader (:3053)

Feature-local because only the downloads page speaks this protocol — the settings screens' browser
prerequisite is the one other route on this service, and it reaches it through `settings.ts`. Its discovery `Item` is
mechanism-agnostic: `ref` is an opaque token to round-trip, never parse.

`/list` and `/list/expand` go through `postReconnectAware` — a bespoke `fetch` rather than the shared
client, because the client discards the response body and these endpoints encode meaning in it:

| HTTP | body                  | thrown                                                                        |
| ---- | --------------------- | ----------------------------------------------------------------------------- |
| 401  | `status: reconnect`   | `ReconnectError` — steer the user to the Reconnect pill                       |
| 422  | `status: unsupported` | `UnsupportedError` — permanent; `message` is display-ready, show verbatim     |
| 409  | `status: passcode`    | `PasscodeError` — zoom gate; `reason: missing \| incorrect`                   |
| 503  | `status: blocked`     | `BlockedError` — the site's bot-protection challenge; transient, no reconnect |

Trade-off: `postReconnectAware` forgoes the client's central `ConnectionError` wrapping, so a refused
connection surfaces as a raw `TypeError` instead of the friendly toast. `PasscodeError` maps the body's
`name` to `lecture` because `name` collides with `Error.name`.

A `blocked` body carries a `message`, and it is the one message never shown: it is an English log line
naming the HTTP shape of the challenge, so `BlockedError` carries none and the page writes its own copy.

`postReconnectAware` and the four error classes are exported and take the `Client` to POST through: the
downloader server's `/download-item` answers with the same four bodies (it forwards auth's verdict
verbatim), so it reuses them rather than restating the vocabulary.

## `features/downloads/services/downloadServer.ts` → downloader server (:3052)

The server that runs the downloads owns both the queueing and the job state, so the downloads page talks to
two services: it discovers and authenticates through the auto-downloader and downloads here.

`downloadItem` POSTs `/download-item` through `postReconnectAware` and returns `{ media, jobIds }`;
resolving _is_ success, since every failure to queue leaves as one of the errors above (or a 500). Rows
still find their jobs by the row's `ref`, not by `jobIds`.

`subscribeJobs(onChange)` and `subscribeRuns(onChange)` each wrap `GET /events`, which fires one contentless
`job:change` ping per job transition (no byte count — see `DOWNLOADS.md`) and one `run:change` ping per
section-run transition; the `open` event calls `onChange` too, for the initial sync and every reconnect
resync. These are the only `EventSource`s outside `services/events.ts`, and they belong here because the
stream is this feature's service, not the database's notify channel. Two subscriptions over one endpoint
means two connections — the price of keeping the jobs reflection and the runs reflection independent.

`fetchJobs()` reads `GET /jobs` and `fetchRuns()` reads `GET /runs` — the single sources of truth the pings
tell you to refetch: every non-evicted job (each carrying the discovery-row `ref` it belongs to, including
ones the Chrome extension started), and every current section run, one per `sectionId`. Both bypass the
shared client for the opposite reason to the three endpoints above — the client toasts every
`ConnectionError`, and a reconnect loop against a downed service would stack one toast per attempt. Both
apply the secret header by hand, as `postReconnectAware` does.

`startSectionRun`, `resumeRun` and `cancelRun` POST `/download-section`, `/runs/:id/resume` and
`/runs/:id/cancel`; they go through the shared client, since a user action against a downed server _should_
toast. `RunTarget` and `SectionRun` live here — they are the server's shapes verbatim (`DOWNLOADS.md`).

`DownloadTool` (`curl` / `yt-dlp`) is null before the child spawns and the real one is known. `startedAt` is
the **server's** epoch ms; the ETA bar compares it to the browser's `Date.now()`, which assumes the two
clocks agree.
