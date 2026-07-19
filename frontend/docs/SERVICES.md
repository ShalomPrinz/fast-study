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
course `overview/` file listing + meta. Also exports `databaseUrl`, the base the SSE `EventSource` is built
from. `fetchCourseMeta` unwraps `{ meta }` and renames `generated_at` → `generatedAt`.

## `events.ts` — the one EventSource

Module-level singleton over `${databaseUrl}/events`, opened on the first `subscribeNotify` and closed when
the last subscriber unsubscribes. Consumed only through `useNotify`.

## `toaster.ts` — the one `react-toastify` import

Exports `toast(kind, message)`, `toastConnectionError`, `toastPromise` (lifecycle toasts for fire-and-track
work like video upload), `toastInitResult`, and re-exports `ToastContainer` (mounted once in `Layout`; the
toastify CSS is imported here too). `toastInitResult` folds a `RunInitResult` into a toast and deliberately
does nothing on `'started'` — completion arrives over SSE. New toast shapes get a helper here.

## URL building — `shared/utils/url.ts`

Hebrew course/lecture/file names must be percent-encoded. Never call `encodeURIComponent` at a call site;
use the `` path`` `` tagged template, which encodes every interpolated value and leaves literals alone.

Its output is already encoded, so **never feed `path` output (or `lectureBase`, built from it) back into
another `path`** — that double-encodes.

Note the asymmetry: the browser route for a lecture is `/{course}/{lecture}` (`lectureRoute`) while the API
path is `/courses/{course}/lectures/{lecture}` (`lectureBase`). `kindQuery` appends `?kind=recitation` to
both; lectures carry no suffix. `overviewGenerateQuery` composes the overview trigger's optional
`extractors` CSV + `from_phase` + `skip_existing`.

## `features/downloads/services/autoDownloader.ts` → auto-downloader (`VITE_AUTODL_URL`, :3053)

Feature-local because only the downloads page speaks this protocol. Its discovery `Item` is
mechanism-agnostic: `ref` is an opaque token to round-trip, never parse.

`/list`, `/list/expand` and `/download-item` go through a bespoke `fetch` rather than the shared client,
because the client discards the response body and these endpoints encode meaning in it:

| HTTP | body                  | thrown |
|------|-----------------------|--------|
| 401  | `status: reconnect`   | `ReconnectError` — steer the user to the Reconnect pill |
| 422  | `status: unsupported` | `UnsupportedError` — permanent; `message` is display-ready, show verbatim |
| 409  | `status: passcode`    | `PasscodeError` — zoom gate; `reason: missing \| incorrect` |

Trade-off: those three endpoints forgo the client's central `ConnectionError` wrapping, so a refused
connection surfaces as a raw `TypeError` instead of the friendly toast. `PasscodeError` maps the body's
`name` to `lecture` because `name` collides with `Error.name`.
