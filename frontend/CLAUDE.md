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
      backend.ts               HTTP client for the FastAPI backend (runStep, fetchTimingStats)
      database.ts              HTTP client for the database service (tree, summary, files, video upload, SSE URL)
    types.ts                 Domain types: FileName, FileStatus, Course, Lecture, Kind, StepResult, …
    App.tsx                  React Router routes; renders Layout + the three views
    main.tsx                 React entry point
    index.css                Single flat stylesheet, CSS variables for theming
    vite-env.d.ts            /// <reference types="vite/client" />
    hooks/
      useCourseTree.ts         courses state, SSE-driven refresh (against ${VITE_DATABASE_URL}/events)
      useInlineEdit.ts         generic inline-input editing
    components/
      Layout.tsx
      Sidebar.tsx
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
- **No FastAPI calls for filesystem state.** Don't add a backend endpoint to query "does file X exist." That belongs in the database service.
- **Single CSS file.** All styles in `index.css` with CSS custom properties. No CSS modules / styled-components.
- **Hebrew rendering.** Folder name labels use `dir="auto"` so the browser auto-detects RTL. Font stack includes Noto Sans Hebrew (Google Fonts) with system fallbacks (Segoe UI, Arial).
- **tsconfig.** One `tsconfig.json` covers `src/` and `vite.config.ts`.

## State (App + hooks)

`useCourseTree(selected)` owns the course tree and derives the currently selected `files: FileStatus` and `transcribePartial` from it. It refreshes on SSE `notify` events and exposes `refreshCourses` + `onCourseClick` (lazy per-course refresh).

`StepResult` is one of:

```ts
{ status: 'done'; url?: string }
{ status: 'error'; message: string }
{ status: 'rate_limited'; rateLimit: RateLimitInfo; progress: RateLimitProgress }
```

`rate_limited` is unique to the transcribe step — the UI should surface `retryAfterSeconds` and `progress.{completed,total}` (chunks done so far) rather than treating it as an error.

## API split

- `src/services/backend.ts` → `${VITE_API_URL}` (FastAPI backend). Only `runStep` and `fetchTimingStats`.
- `src/services/database.ts` → `${VITE_DATABASE_URL}` (database service). Everything else: tree CRUD, summary CRUD, `uploadVideo`, `fileUrl`, and the `databaseUrl` export used to build the SSE EventSource URL.

Both clients are built from `createClient(baseUrl)` in `src/services/http.ts`, which centralizes the `if (!res.ok) throw httpError(res)` / JSON-encode / `Content-Type` boilerplate and exposes a `request(...)` escape hatch for endpoints whose behavior intentionally diverges (e.g. `deleteFile`'s fire-and-forget, `uploadVideo`'s bespoke error message, the summary endpoints' "parse JSON regardless of status").

Course / lecture / file names are `encodeURIComponent`-encoded in URLs to handle Hebrew folder names. `kind === 'recitation'` is appended as `?kind=recitation` via the shared `kindQuery` helper in `services/http.ts`.
