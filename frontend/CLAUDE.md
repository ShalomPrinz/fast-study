# CLAUDE.md — frontend

## What this is

React + Vite + TypeScript app that drives the lecture-processing pipeline. It talks to two servers:

- **Vite dev server** (`localhost:5173`) — serves the app AND hosts filesystem endpoints via a custom Vite plugin: `/api/tree`, `/api/summary`, `/api/files`, `/api/events`, `/api/notify`.
- **FastAPI backend** (`localhost:8000`) — runs the pipeline steps (`/courses/.../run/{step}`) and serves timing stats (`/timing/{op}`).

All filesystem state is read from the Vite plugin (Node `fs` against `VITE_DATA_ROOT`). The FastAPI backend never answers "does file X exist."

## Running

```bash
cd frontend
npm run dev      # dev server on localhost:5173
npm run build    # tsc -b && vite build → dist/
```

## Environment

`.env` (not committed):

| Variable          | Purpose                                                          |
|-------------------|------------------------------------------------------------------|
| `VITE_DATA_ROOT`  | Absolute path to the data directory (read server-side by `fsPlugin`) |
| `VITE_API_URL`    | Backend base URL, defaults to `http://localhost:8000`            |

## Directory layout

```
frontend/
  fs-api/                    Node-side filesystem API mounted on the Vite dev server
    index.ts                   fsPlugin(dataRoot): wires the four handlers into Vite
    fs-reader.ts               pure Node fs (readTree, readCourse, RECITATIONS_DIR)
    handlers/
      tree.ts                    /api/tree     — course/lecture CRUD (GET/POST/PATCH/PUT/DELETE)
      summary.ts                 /api/summary  — GET/PUT/DELETE markdown content
      files.ts                   /api/files    — static file streaming for video/pdf/etc
      events.ts                  /api/events   — SSE stream + /api/notify POST endpoint that broadcasts
  src/
    api.ts                   HTTP client (fetchTree, runStep, uploadVideo, summary CRUD, timing, …)
    types.ts                 Domain types: FileName, FileStatus, Course, Lecture, Kind, StepResult, …
    App.tsx                  React Router routes; renders Layout + the three views
    main.tsx                 React entry point
    index.css                Single flat stylesheet, CSS variables for theming
    vite-env.d.ts            /// <reference types="vite/client" />
    hooks/
      useCourseTree.ts         courses state, SSE-driven refresh, derived files/transcribePartial
      useInlineEdit.ts         generic inline-input editing (value state + ref + auto-focus/select)
    components/
      Layout.tsx                top-level layout shell (sidebar + outlet)
      Sidebar.tsx               collapsible course tree, lecture/recitation selection
      MainView.tsx              per-lecture: step buttons, status, file links
      EditSummaryView.tsx       inline editor for summary.md
      PdfViewer.tsx             react-pdf preview of summary.pdf
      ConfirmModal.tsx          generic confirm dialog
      Icon.tsx                  shared SVG icon component
  vite.config.ts             imports fsPlugin from ./fs-api and wires it into defineConfig
  tsconfig.json              single config covering src/ and vite.config.ts
  index.html                 loads Inter + Noto Sans Hebrew from Google Fonts
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

- **Filesystem access is on the Vite side.** The browser can't read local files; the FastAPI backend doesn't expose tree state. A custom Vite plugin (`fsPlugin` in `vite.config.ts` → `fs-api/index.ts`) registers middleware on the dev server. Each request re-reads `VITE_DATA_ROOT` with Node's `fs` — no Vite restart needed to see new files.
- **Server-Sent Events for cross-service refresh.** `useCourseTree.ts` opens `/api/events` and listens for `notify` events. When the downloader finishes a download it POSTs `/api/notify` (see `downloader/server.js::notifyFrontend`), which fans out an SSE message to all subscribed sidebars so they re-fetch `/api/tree`. Failure is silent — downloads must work even when the frontend isn't running.
- **No FastAPI calls for filesystem state.** Don't add a backend endpoint to query "does file X exist." After a pipeline step succeeds, just re-fetch `/api/tree`.
- **Single CSS file.** All styles in `index.css` with CSS custom properties. No CSS modules / styled-components.
- **Hebrew rendering.** Folder name labels use `dir="auto"` so the browser auto-detects RTL. Font stack includes Noto Sans Hebrew (Google Fonts) with system fallbacks (Segoe UI, Arial).
- **tsconfig.** One `tsconfig.json` covers both `src/` and `vite.config.ts`. Node types for the Vite plugin come from a `/// <reference types="node" />` directive — no separate `tsconfig.node.json`.

## State (App + hooks)

`useCourseTree(selected)` owns the course tree and derives the currently selected `files: FileStatus` and `transcribePartial` from it. It refreshes on SSE `notify` events and exposes `refreshCourses` + `onCourseClick` (lazy per-course refresh).

`StepResult` is one of:

```ts
{ status: 'done'; url?: string }
{ status: 'error'; message: string }
{ status: 'rate_limited'; rateLimit: RateLimitInfo; progress: RateLimitProgress }
```

`rate_limited` is unique to the transcribe step — the UI should surface `retryAfterSeconds` and `progress.{completed,total}` (chunks done so far) rather than treating it as an error.

## API (src/api.ts)

Backend pipeline calls (`runStep`, `fetchTimingStats`) hit `${VITE_API_URL}`. All other functions (`fetchTree`, `fetchCourse`, course/lecture CRUD, `uploadVideo`, summary CRUD, `fileUrl`) hit relative `/api/...` paths handled by the Vite plugin.

Course / lecture / file names are `encodeURIComponent`-encoded in URLs to handle Hebrew folder names. `kind === 'recitation'` is appended as `?kind=recitation` via the shared `kindQuery` helper.
