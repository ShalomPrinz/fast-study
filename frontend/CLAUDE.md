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
    constants/
      pipeline.ts              PIPELINE step list + derived STEP_FILE / STEP_INPUT_FILE / STEP_LABEL / STEP_ERROR_LABEL / STEP_SET maps
    contexts/
      RunnerStatusContext.tsx  Shared RunnerStatus state + a single EventSource and dedupe ref (provider wraps Layout)
    types.ts                 Domain types: FileName, FileStatus, Course, Lecture, Kind, StepResult, RunnerStatus, LectureContext, …
    App.tsx                  React Router routes; renders Layout + the three views
    main.tsx                 React entry point
    index.css                Single flat stylesheet, CSS variables for theming
    vite-env.d.ts            /// <reference types="vite/client" />
    utils/
      inFlightKey.ts
      namingSuggestion.ts
      route.ts                 lectureRoute() / kindSearch() — router-side URL builders, shared by Layout, RunnerPipelineRow, MainView
    hooks/
      useCourseTree.ts         courses state, SSE-driven refresh (against ${VITE_DATABASE_URL}/events)
      useInlineEdit.ts         generic inline-input editing
      useTimingStats.ts        (step, fileSize) -> TimingStats, with staleness guard for late responses
      useRemoteInflightState.ts  synthesizes an inflight descriptor when the runner is processing the open lecture
    components/
      Layout.tsx                routes outlet + RunnerStatusProvider + ToastContainer
      Sidebar.tsx               course/lecture tree
      NewCourseRow.tsx          inline "new course" input row
      RunnerPipelineRow.tsx     runner status/CTA row; click while running to jump to current lecture
      MainView.tsx
      EditSummaryView.tsx
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
- **Server-Sent Events for cross-service refresh.** `useCourseTree.ts` opens `${VITE_DATABASE_URL}/events` and listens for `notify` events. When the downloader finishes a download it POSTs `${database}/notify` (see `downloader/server.js::notifyFrontend`), which fans an SSE message out to all subscribed sidebars so they re-fetch the tree. Failure is silent — downloads must work even when the frontend isn't running.
- **Runner status is SSE-driven, not polled.** `RunnerStatusContext` opens the same `${VITE_DATABASE_URL}/events` stream and refetches `GET /status` once per `notify` ping. The backend's `runner.py` fires a notify on every meaningful state change (step start/done, rate-limit, error, run complete). The provider also de-dupes `lastError` toasts via a ref so the same error doesn't fire twice. Sidebar and MainView share one EventSource by reading from the context.
- **No FastAPI calls for filesystem state.** Don't add a backend endpoint to query "does file X exist." That belongs in the database service.
- **Pipeline steps are declared once.** `constants/pipeline.ts` is the single source of truth for the step list, prereq chain, action labels, and error labels. Don't hard-code a step name or input file anywhere else — derive from `PIPELINE` / `STEP_*` maps.
- **Single CSS file.** All styles in `index.css` with CSS custom properties. No CSS modules / styled-components.
- **Hebrew rendering.** Folder name labels use `dir="auto"` so the browser auto-detects RTL. Font stack includes Noto Sans Hebrew (Google Fonts) with system fallbacks (Segoe UI, Arial).
- **Toast notifications.** `react-toastify`'s `ToastContainer` is mounted once in `Layout`. Surface non-blocking errors via `toast.error(...)` rather than alerts or inline banners. **UI belongs in components, not contexts / hooks etc.** Contexts and hooks communicate events upward via callbacks (e.g. `sendUpdate(kind, message)`) — callers decide how to render them. Never import `toast` inside a context or hook.
- **tsconfig.** One `tsconfig.json` covers `src/` and `vite.config.ts`.

## State (App + hooks)

`useCourseTree(selected)` owns the course tree and derives the currently selected `files: FileStatus` and `transcribePartial` from it. It refreshes on SSE `notify` events and exposes `refreshCourses` + `onCourseClick` (lazy per-course refresh). `Layout` calls it and passes `{ files, transcribePartial, refreshCourses, kind }` to the child route as a typed outlet context (`LectureContext`).

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

## API split

- `src/services/backend.ts` → `${VITE_API_URL}` (FastAPI backend). `runStep`, `fetchTimingStats`, `runAll`, `fetchRunnerStatus` (the last two normalize `snake_case` → `camelCase`).
- `src/services/database.ts` → `${VITE_DATABASE_URL}` (database service). Everything else: tree CRUD, summary CRUD, `uploadVideo`, `fileUrl`, and the `databaseUrl` export used to build the SSE EventSource URL.

Both clients are built from `createClient(baseUrl)` in `src/services/http.ts`, which centralizes the `if (!res.ok) throw httpError(res)` / JSON-encode / `Content-Type` boilerplate and exposes a `request(...)` escape hatch for endpoints whose behavior intentionally diverges (e.g. `deleteFile`'s fire-and-forget, `uploadVideo`'s bespoke error message, the summary endpoints' "parse JSON regardless of status").

Course / lecture / file names are `encodeURIComponent`-encoded in URLs to handle Hebrew folder names. `kind === 'recitation'` is appended as `?kind=recitation` via the shared `kindQuery` helper in `services/http.ts`.
