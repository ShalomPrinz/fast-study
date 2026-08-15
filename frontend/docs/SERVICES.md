# Services

Each file under `src/services/` is the **single boundary** for one external concern. Components and hooks
go through them — no call site touches `fetch`, `EventSource` or `react-toastify` directly.

## `http.ts` — client factory

`createClient(baseUrl, serviceName)` centralizes `!res.ok → throw`, JSON encoding and headers, and exposes
`url(path)` for links the browser opens itself. URL string building lives in `shared/utils/url.ts`, not here.

**Connection errors are handled once, here.** Per the Fetch spec only a network failure rejects as a
`TypeError` (aborts are `DOMException` and propagate untouched), so that branch wraps the error in a typed
`ConnectionError` carrying the friendly service name, toasts it, and rethrows. `toastConnectionError` keys
the toast by base URL, so a downed service reuses one toast instead of stacking. Call sites must not add
their own connection-error handling; they either ignore the throw or check `isConnectionError` before
showing a second message.

## `backend.ts` → FastAPI (`VITE_API_URL`)

Pipeline triggers (`runStep`, `runPipeline`, `runAll`), `fetchRunnerStatus`, `fetchTimingStats`, and the
course-overview endpoints (`fetchOverviewExtractors`, `runOverview`, `fetchCourseStatus`). The wire format
is `snake_case`; normalization to camelCase happens here and nowhere else, so `types.ts` shapes stay clean.

## `database.ts` → database service (`VITE_DATABASE_URL`)

Everything filesystem-backed: tree, course/lecture CRUD, summary read/save/revert, video upload, file URLs,
course `overview/` file listing + meta. `materialUrl`/`deleteMaterial` hit the same per-file routes as
`fileUrl`/`deleteFile` but take a runtime name, since a material's name comes from the tree rather than the
fixed `FileName` set. Also exports `databaseUrl`, the base the SSE `EventSource` is built
from. `fetchCourseMeta` unwraps `{ meta }` and renames `generated_at` → `generatedAt`.

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

## `features/downloads/services/autoDownloader.ts` → auto-downloader (`VITE_AUTODL_URL`, :3053)

Feature-local because only the downloads page speaks this protocol. Its discovery `Item` is
mechanism-agnostic: `ref` is an opaque token to round-trip, never parse.

`/list` and `/list/expand` go through `postReconnectAware` — a bespoke `fetch` rather than the shared
client, because the client discards the response body and these endpoints encode meaning in it:

| HTTP | body                  | thrown                                                                    |
| ---- | --------------------- | ------------------------------------------------------------------------- |
| 401  | `status: reconnect`   | `ReconnectError` — steer the user to the Reconnect pill                   |
| 422  | `status: unsupported` | `UnsupportedError` — permanent; `message` is display-ready, show verbatim |
| 409  | `status: passcode`    | `PasscodeError` — zoom gate; `reason: missing \| incorrect`               |

Trade-off: `postReconnectAware` forgoes the client's central `ConnectionError` wrapping, so a refused
connection surfaces as a raw `TypeError` instead of the friendly toast. `PasscodeError` maps the body's
`name` to `lecture` because `name` collides with `Error.name`.

`postReconnectAware` and the three error classes are exported and take the `Client` to POST through: the
downloader server's `/download-item` answers with the same three bodies (it forwards auth's verdict
verbatim), so it reuses them rather than restating the vocabulary.

## `features/downloads/services/downloadServer.ts` → downloader server (`VITE_DOWNLOADER_URL`, :3052)

The server that runs the downloads owns both the queueing and the job state, so the downloads page talks to
two services: it discovers and authenticates through the auto-downloader and downloads here.

`downloadItem` POSTs `/download-item` through `postReconnectAware` and returns `{ media, jobIds }`;
resolving _is_ success, since every failure to queue leaves as one of the errors above (or a 500). Rows
still find their jobs by the row's `ref`, not by `jobIds`.

`subscribeJobs(onChange)` wraps `GET /events`, which fires one contentless `job:change` ping per job
transition (no byte count — see `DOWNLOADS.md`); the `open` event calls `onChange` too, for the initial
sync and every reconnect resync. This is the one `EventSource` outside `services/events.ts`, and it belongs
here because the stream is this feature's service, not the database's notify channel.

`fetchJobs()` reads `GET /jobs`, the single source of truth the ping tells you to refetch: every non-evicted
job (each carrying the discovery-row `ref` it belongs to, including ones the Chrome extension started). It
bypasses the shared client for the opposite reason to the three endpoints above — the client toasts every
`ConnectionError`, and a reconnect loop against a downed service would stack one toast per attempt.

`DownloadTool` (`curl` / `yt-dlp`) is null before the child spawns and the real one is known. `startedAt` is
the **server's** epoch ms; the ETA bar compares it to the browser's `Date.now()`, which assumes the two
clocks agree.
