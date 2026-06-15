# CLAUDE.md — frontend

## What this is

React + Vite + TypeScript app that drives the lecture-processing pipeline. It talks to two backends — neither of which is the Vite dev server. Filesystem state is owned by the database service; the Vite dev server only serves the SPA.

- **FastAPI backend** (`localhost:8000`) — runs the pipeline steps (`/courses/.../run/{step}`) and serves timing stats (`/timing/{op}`).
- **Database service** (`localhost:8001`) — owns every read/write under `DATA_ROOT`: tree, course/lecture CRUD, summary CRUD, file streaming, SSE notify channel.

The browser never reads `DATA_ROOT` directly. The custom Vite plugin that used to host `/api/*` is gone.

## Running

```bash
cd frontend
npm run dev      # dev server on localhost:5173
npm run build    # tsc -b && vite build → dist/
```

## Environment

`.env` (not committed):

| Variable              | Purpose                                                                  |
|-----------------------|--------------------------------------------------------------------------|
| `VITE_API_URL`        | FastAPI backend base URL, defaults to `http://localhost:8000`            |
| `VITE_DATABASE_URL`   | Database service base URL, defaults to `http://localhost:8001`           |

## Directory layout

```
frontend/
  src/
    services/
      http.ts                  typed fetch client + shared `httpError` / `kindQuery`
      backend.ts               HTTP client for the FastAPI backend (runStep, fetchTimingStats, runAll, fetchRunnerStatus)
      database.ts              HTTP client for the database service (tree, summary, files, video upload, SSE URL)
      events.ts         singleton EventSource subscription boundary — subscribeNotify(cb) ref-counts one shared stream
      toaster.ts               single boundary around react-toastify — exports toastError/toastInfo/toastByKind/toastPromise/toastInitResult + ToastContainer
    constants/
      pipeline.ts              PIPELINE step list + derived STEP_FILE / STEP_INPUT_FILE / STEP_LABEL / STEP_ERROR_LABEL / STEP_SET maps
    contexts/
      RunnerStatusContext.tsx  Shared RunnerStatus state + a single EventSource and dedupe ref (provider wraps Layout)
      CourseTreeContext.tsx    Owns courses state + refreshCourses; SSE-driven refresh via useNotify
    types.ts                 Domain types: FileName, FileStatus, Course, Lecture, Kind, StepResult, RunnerStatus, …
    App.tsx                  React Router routes; renders Layout + the three views
    main.tsx                 React entry point
    index.css                Single flat stylesheet, CSS variables for theming
    vite-env.d.ts            /// <reference types="vite/client" />
    utils/
      inFlightKey.ts
      namingSuggestion.ts
      route.ts                 lectureRoute() / kindSearch() — router-side URL builders, shared by Layout, RunnerPipelineRow, MainView
      courseTree.ts            findLecture(courses, course, lecture, kind)
      format.ts                formatDuration(seconds) — human-readable duration strings
    hooks/
      useInlineEdit.ts         generic inline-input editing
      useKindParam.ts          reads ?kind=recitation from useSearchParams, returns a Kind
      useLectureRoute.ts       reads { course, lecture, kind } from useParams + useKindParam and derives { files, transcribePartial } from CourseTreeContext
      useNotify.ts             subscribes to SSE notify events via services/events.ts singleton; callback stays fresh via ref
      useToggleSet.ts          string-keyed expand/collapse set with toggle/add + auto-prune to valid keys
      useTimingStats.ts        (step, fileSize) -> TimingStats, with staleness guard for late responses
      useRemoteInflightState.ts  synthesizes an inflight descriptor when the runner is processing the open lecture
      useReportOnce.ts         dedupes `(key, msg)` pairs sent to a callback; backs RunnerStatusContext's per-lecture + runner-crash error fan-out
    routes/
      Layout.tsx                routes outlet + RunnerStatusProvider + ToastContainer
      MainView.tsx
      EditSummaryView.tsx
    components/
      sidebar/
        Sidebar.tsx             course/lecture tree
        NewCourseRow.tsx        inline "new course" input row
        RunnerPipelineRow.tsx   runner status/CTA row; click while running to jump to current lecture
      InlineEditInput.tsx       shared inline-edit input (Enter=commit, Escape/Blur=cancel)
      PdfViewer.tsx
      ConfirmModal.tsx
      Icon.tsx
  vite.config.ts             plain React plugin — no fs plugin
  tsconfig.json
  index.html
```

## Routing

`react-router-dom` (v7). Routes defined in `App.tsx`:

| Path                          | View                |
|-------------------------------|---------------------|
| `/`                           | empty state         |
| `/:course/:lecture`           | `MainView`          |
| `/:course/:lecture/edit`      | `EditSummaryView`   |

`kind` (lecture vs recitation) is a query param (`?kind=recitation`) propagated everywhere it's needed.

## Key design decisions

- **Filesystem access lives in the database service, not the frontend.** Every URL pointing at filesystem state is built in `src/services/database.ts` against `VITE_DATABASE_URL`. The browser still can't read local files; the Vite dev server no longer pretends to. After a pipeline step succeeds, just re-fetch the tree from the database service.
- **Server-Sent Events for cross-service refresh.** All SSE subscriptions go through `services/events.ts`, which lazily opens one shared `EventSource(${VITE_DATABASE_URL}/events)` and ref-counts subscribers — the stream is closed when the last subscriber unmounts. `useNotify(cb)` is the hook interface; `CourseTreeContext` and `RunnerStatusContext` both call it. When the downloader finishes a download it POSTs `${database}/notify` (see `downloader/server.js::notifyFrontend`), which fans an SSE message out to all subscribed listeners so they re-fetch. Failure is silent — downloads must work even when the frontend isn't running.
- **Runner status is SSE-driven, not polled.** `RunnerStatusContext` calls `useNotify(refresh)` to refetch `GET /status` on each `notify` ping. The backend's `runner.py` fires a notify on every meaningful state change (step start/done, rate-limit, error, run complete). The provider also de-dupes `lastError` toasts via a ref so the same error doesn't fire twice. Sidebar and MainView share runner state by reading from the context.
- **No FastAPI calls for filesystem state.** Don't add a backend endpoint to query "does file X exist." That belongs in the database service.
- **Connection-refused errors are handled centrally in the http client.** When a `fetch` rejects with a `TypeError` (the Fetch spec's signal for a network failure — server unreachable; aborts are `DOMException` and propagate untouched), `createClient(baseUrl, serviceName)` wraps it in a typed `ConnectionError` (in `services/http.ts`) carrying the friendly service name ("backend service" / "database service"), toasts it via `toastConnectionError`, and rethrows. So every request surfaces "which service is down" in one place, and existing per-call error handling is unaffected. `toastConnectionError` (in `toaster.ts`) uses a `toastId` keyed per service so polling a downed service reuses one toast instead of stacking. Don't add connection-error handling at call sites — it belongs in this one catch.
- **Pipeline steps are declared once.** `constants/pipeline.ts` is the single source of truth for the step list, prereq chain, action labels, and error labels. Don't hard-code a step name or input file anywhere else — derive from `PIPELINE` / `STEP_*` maps.
- **Single CSS file.** All styles in `index.css` with CSS custom properties. No CSS modules / styled-components.
- **Hebrew rendering.** Folder name labels use `dir="auto"` so the browser auto-detects RTL. Font stack includes Noto Sans Hebrew (Google Fonts) with system fallbacks (Segoe UI, Arial).
- **Toast notifications.** `react-toastify`'s `ToastContainer` is mounted once in `Layout`. Surface non-blocking errors via `toast.error(...)` rather than alerts or inline banners. **UI belongs in components, not contexts / hooks etc.** Contexts and hooks communicate events upward via callbacks (e.g. `sendUpdate(kind, message)`) — callers decide how to render them. Never import `toast` inside a context or hook.
- **tsconfig.** One `tsconfig.json` covers `src/` and `vite.config.ts`.
- **Imports use the `@/` alias for anything under `src/`.** `@/*` maps to `src/*` (configured in `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias`). Write `import x from '@/services/database'`, never `'../../services/database'`. Sibling-only imports (same directory) may stay relative.

## State (App + hooks)

`CourseTreeContext` owns the course tree. The provider holds `courses` state, refreshes on SSE `notify` events, and exposes `{ courses, refreshCourses }` via `useCourseTreeContext()` — no props needed. `Sidebar`, `RefreshCoursesButton`, `NewCourseRow`, `usePendingUpload`, and `MainView` all read from the context directly; `Layout` just wraps the provider. The currently selected lecture's `files` / `transcribePartial` are derived inside `useLectureRoute` from the context's `courses` plus the route params — there is no outlet context.

`useRemoteInflightState({ course, lecture, kind, files, transcribePartial })` reads `RunnerStatusContext` and, if the runner is currently working on the open lecture, returns an inflight descriptor `{ step, startedAt, timingStats, completedFraction }`. Callers decide whether a local run preempts this.

`useTimingStats(step, fileSizeBytes)` returns the FastAPI `/timing/{step}` linear-regression estimate, ignoring late responses for `(step, size)` keys the caller has moved on from.

`StepResult` is one of:

```ts
{ status: 'done'; url?: string; usedMaterial?: boolean }
{ status: 'error'; message: string }
{ status: 'rate_limited'; rateLimit: RateLimitInfo; progress: RateLimitProgress }
```

`rate_limited` is unique to the transcribe step — the UI should surface `retryAfterSeconds` and `progress.{completed,total}` (chunks done so far) rather than treating it as an error. `usedMaterial` is returned by the summarize step when an optional `material.pdf` was found and handed to Gemini alongside the transcript.

`RunnerStatus` (from `GET /status`, normalized in `services/backend.ts`):

```ts
{
  runner: { running: boolean; total: number; done: number; lastError: string | null }
  inFlight: InFlightEntry[]   // every active step from any trigger (runner, /pipeline, /run/{step})
  errors: Record<string, string>  // skey → last error message, persists after the entry leaves inFlight
}
```

## Services (`src/services/`)

Each file under `src/services/` is the **single boundary** for one external concern. Components and hooks must go through these — no component should talk to `fetch`, `react-toastify`, or any other external library directly when a service already wraps it.

### `http.ts` — typed fetch client factory

`createClient(baseUrl)` builds the per-service HTTP clients used by `backend.ts` and `database.ts`. Centralizes `if (!res.ok) throw httpError(res)` / JSON encoding / `Content-Type` headers, and exposes a `request(...)` escape hatch for endpoints whose behavior intentionally diverges (e.g. `deleteFile`'s fire-and-forget, `uploadVideo`'s bespoke error message, the summary endpoints' "parse JSON regardless of status"). Also exports the shared `kindQuery` helper for `?kind=recitation`.

### `backend.ts` — FastAPI backend client → `${VITE_API_URL}`

Exposes `runStep`, `runPipeline`, `fetchTimingStats`, `runAll`, `fetchRunnerStatus`. The last two normalize the wire `snake_case` shape to camelCase.

### `database.ts` — Database service client → `${VITE_DATABASE_URL}`

Everything filesystem-backed: tree CRUD, course/lecture CRUD, summary read/save/revert, `uploadVideo`, `fileUrl`, and the `databaseUrl` export used to build the SSE EventSource URL in `CourseTreeContext` and `RunnerStatusContext`.

### `toaster.ts` — the only `react-toastify` import site

Nothing else in the codebase imports from `react-toastify`. All toasts go through this service. Exports:

- `toastError(msg)` — typed wrappers around `toast.error` / `toast.info`.
- `toastByKind(kind, msg)` where `kind: 'info' | 'error'` — used by `Layout` to bridge `RunnerStatusProvider`'s `sendUpdate(kind, message)` callback to the toast layer (the context itself does not import this service — UI lives in components).
- `toastPromise(promise, { pending, success, error })` — `toast.promise` wrapper for fire-and-track async work like `uploadVideo`.
- `toastInitResult(result, { busy, error })` — folds a `RunInitResult` ('started' | 'busy' | 'error') into the right toast; 'started' is a no-op because completion arrives via SSE.
- `ToastContainer` re-export — `Layout` mounts it once. The `react-toastify` CSS is also imported here, not in `main.tsx`.

When you need a new toast shape, add a helper here and import it from this service — do not reach for `toast` directly.

### URL encoding convention

Course / lecture / file names are `encodeURIComponent`-encoded in URLs to handle Hebrew folder names. `kind === 'recitation'` is appended as `?kind=recitation` via the shared `kindQuery` helper in `services/http.ts`.
