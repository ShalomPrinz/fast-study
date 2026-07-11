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
      http.ts                  typed fetch client + shared `httpError`
      backend.ts               HTTP client for the FastAPI backend (runStep, runPipeline, fetchTimingStats, runAll, fetchRunnerStatus, overview: fetchOverviewExtractors, runOverview, fetchCourseStatus)
      database.ts              HTTP client for the database service (tree, summary, files, video upload, SSE URL, overview files list + overviewFileUrl for opening one overview file, fetchCourseMeta for the per-slug overview meta/ranges)
      events.ts         singleton EventSource subscription boundary — subscribeNotify(cb) ref-counts one shared stream
      toaster.ts               single boundary around react-toastify — exports toast/toastConnectionError/toastPromise/toastInitResult + ToastContainer
    constants/
      pipeline.ts              PIPELINE step list + derived STEP_FILE / STEP_INPUT_FILE / STEP_LABEL / STEP_ERROR_LABEL / STEP_SET maps
      overview.ts              OVERVIEW_STEPS (phase→suffix→label table: extract.txt/analyze.md/topics.md/to_pdf.pdf) + stepsFor(phases) to pick one extractor's subset; generatedFiles/lastGeneratedFile/startedSlug all take an extractor's phases and operate on stepsFor(phases) (topics → topics.md+topics.pdf, no .txt)
    contexts/
      RunnerStatusContext.tsx  Shared RunnerStatus state + a single EventSource and dedupe ref (provider wraps Layout)
      CourseTreeContext.tsx    Owns courses state + refreshCourses; SSE-driven refresh via useNotify
    types.ts                 Domain types: FileName, FileStatus, Course, Lecture, Kind, Step, RunInitResult, InFlightEntry, RunnerStatus, AppMode, OverviewExtractor, CourseStatus, CourseFile, OverviewMeta ({slug → {lectures/recitations: {start,end}|null, generatedAt}}), InlineEdit, ExpandHandle (collapse/expand handle for a child whose open-state its parent owns), …
    App.tsx                  React Router routes; renders Layout + the three views
    main.tsx                 React entry point
    index.css                Single flat stylesheet, CSS variables for theming
    vite-env.d.ts            /// <reference types="vite/client" />
    utils/
      inFlightKey.ts
      namingSuggestion.ts
      url.ts                   all URL/path string building: path`` encode-by-default tagged template, kindQuery() query suffix, lectureRoute() browser route, lectureBase() API path, courseRoute() browser route + courseOverviewBase() API path + extractorsQuery() CSV suffix + overviewGenerateQuery() (extractors CSV + optional from_phase + optional skip_existing) for the course overview feature
      courseTree.ts            findLecture(courses, course, lecture, kind)
      overview.ts              formatRange(entry) — "Lectures 2-9, Recitations 1-4" / "No Lectures"/"No Recitations" from an OverviewMeta entry
      format.ts                formatDuration(seconds) + formatMonthDate(iso) ("10th July") / formatFullTimestamp(iso) ("Friday, 10 July 2026, 14:32") for overview meta subtitle
      lectureSort.ts           sortLectures(items) — natural-order sort of lectures/recitations by name
    hooks/
      useInlineEdit.ts         generic inline-input editing
      useKindParam.ts          reads ?kind=recitation from useSearchParams, returns a Kind
      useLectureRoute.ts       reads { course, lecture, kind } from useParams + useKindParam and derives { files, transcribePartial } from CourseTreeContext
      useNotify.ts             subscribes to SSE notify events via services/events.ts singleton; callback stays fresh via ref
      useToggleSet.ts          string-keyed expand/collapse set with toggle/add + auto-prune to valid keys
      useTimingStats.ts        (step, fileSize) -> TimingStats, with staleness guard for late responses
      useRemoteInflightState.ts  synthesizes an inflight descriptor when the runner is processing the open lecture
      useReportOnce.ts         dedupes `(key, msg)` pairs sent to a callback; backs RunnerStatusContext's per-lecture + runner-crash error fan-out
      useLatestRequest.ts      returns a wrapper that resolves only the most recent in-flight promise, dropping superseded responses
      useShiftHeld.ts          tracks whether the Shift key is currently held
      useSelection.ts          route-derived { selected, onSelect } — reads useMatch + useKindParam, navigates via lectureRoute()
      useAddLecture.ts         per-course add-lecture/recitation flow → { target, edit, start, cancel, commit } (backs CourseGroup's add)
    routes/
      Layout.tsx                routes outlet + CourseTreeProvider + RunnerStatusProvider + Sidebar + ToastContainer
      MainView.tsx
      EditSummaryView.tsx
      CourseView.tsx          per-course overview view: per-extractor row with a caret (useToggleSet) that expands a per-phase breakdown filtered to that extractor's phases (stepsFor(extractor.phases) — pattern extractors show {slug}.txt/.md/.pdf, the immediate topics extractor shows {slug}.md(Collect)/.pdf with no .txt row), ✓/spinner, PDF-only open button, per-step ↺ re-generate-from-here; header has "Generate" (→ ↺ re-generate-all once the last file exists, + open-PDF) + a "Continue Generating"/"Generate All" button (skip_existing, fills only missing work, no warning); SSE-refreshed status
    components/
      sidebar/
        index.ts                re-exports Sidebar as the default
        Sidebar.tsx             header + ModeToggle; declares the mode→{label, Component} map, no state/branching
        LecturesSidebar.tsx     lecture/course tree shell, no props — mounts PendingUploadProvider; body renders NewCourseRow + RunnerPipelineRow + the active-course <CourseGroup> nav + <ArchivedSection>
        tree/
          CourseGroup.tsx       one course group (1 prop `course`): owns expanded/recExpanded + per-group auto-expand + useAddLecture(course); provides CourseGroupContext; renders <CourseHeader> + a <LectureListProvider kind="lecture"> wrapping <LectureList/><AddLectureInput/> + <RecitationsGroup>. Hands CourseHeader/RecitationsGroup 1-prop ExpandHandles since both expand states live here (so recExpanded persists across course collapse)
          CourseGroupContext.tsx  { course, add } + useCourseGroup() — one course group's shared course + add-lecture flow
          CourseHeader.tsx      course-header row (1 prop `expand: ExpandHandle`): local course-rename; owns toggleArchived + lecture-add; reads useCourseGroup()/useSelection()/useShiftHeld()/useCourseTreeContext()
          RecitationsGroup.tsx  recitations sub-group (1 prop `expand: ExpandHandle`): owns the recitations "+" + useShiftHeld() gate; renders <LectureListProvider kind="recitation"> with <LectureList/><AddLectureInput/>
          LectureListContext.tsx  1-member `kind` context (LectureListProvider + useLectureListKind()) — which list (lecture vs recitation) a subtree renders
          LectureList.tsx       0 props: the PaginatedList of <LectureItem> for the provider's kind (course.lectures vs course.recitations)
          AddLectureInput.tsx   0 props: the inline new-lecture/recitation input row; renders only in the list whose kind is currently being added (add.target.kind === useLectureListKind())
          ArchivedSection.tsx   0 props: the archived-courses footer toggle + collapsible panel (local showArchived; reads archived from useCourseTreeContext())
          LectureItem.tsx       one lecture/recitation row (1 prop `lecture`): local rename + drag-over; reads kind via useLectureListKind(), course via useCourseGroup(), plus useSelection()/usePendingUpload()
        ModeToggle.tsx          owns the localStorage-persisted AppMode; renders the "Lectures"/"Courses" segments and the selected mode's body from the map
        CoursesList.tsx         overview sidebar body: flat list of non-archived courses → /course/:course
        NewCourseRow.tsx        inline "new course" input row
        RunnerPipelineRow.tsx   runner status/CTA row; click while running to jump to current lecture
        RefreshCoursesButton.tsx  manual tree-refresh button (reads CourseTreeContext)
        PaginatedList.tsx       generic "show more" chunked list
        PendingUploadModal.tsx  PendingUploadProvider (owns pending state, renders its own replace-confirm modal) + usePendingUpload() context → { trigger, confirm }
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
| `/course/:course`            | `CourseView`        |
| `/:course/:lecture`           | `MainView`          |
| `/:course/:lecture/edit`      | `EditSummaryView`   |

`kind` (lecture vs recitation) is a query param (`?kind=recitation`) propagated everywhere it's needed. The static `course` segment outranks the dynamic `/:course/:lecture` pattern in v7 route ranking, so the two never collide.

## Key design decisions

- **Filesystem access lives in the database service, not the frontend.** Every URL pointing at filesystem state is built in `src/services/database.ts` against `VITE_DATABASE_URL`. The browser still can't read local files; the Vite dev server no longer pretends to. After a pipeline step succeeds, just re-fetch the tree from the database service.
- **Server-Sent Events for cross-service refresh.** All SSE subscriptions go through `services/events.ts`, which lazily opens one shared `EventSource(${VITE_DATABASE_URL}/events)` and ref-counts subscribers — the stream is closed when the last subscriber unmounts. `useNotify(cb)` is the hook interface; `CourseTreeContext` and `RunnerStatusContext` both call it. When the downloader finishes a download it POSTs `${database}/notify` (see `downloader/server.js::notifyFrontend`), which fans an SSE message out to all subscribed listeners so they re-fetch. Failure is silent — downloads must work even when the frontend isn't running.
- **Runner status is SSE-driven, not polled.** `RunnerStatusContext` calls `useNotify(refresh)` to refetch `GET /status` on each `notify` ping. The backend's `runner.py` fires a notify on every meaningful state change (step start/done, rate-limit, error, run complete). The provider also de-dupes `lastError` toasts via a ref so the same error doesn't fire twice. Sidebar and MainView share runner state by reading from the context.
- **No FastAPI calls for filesystem state.** Don't add a backend endpoint to query "does file X exist." That belongs in the database service.
- **Connection-refused errors are handled centrally in the http client.** When a `fetch` rejects with a `TypeError` (the Fetch spec's signal for a network failure — server unreachable; aborts are `DOMException` and propagate untouched), `createClient(baseUrl, serviceName)` wraps it in a typed `ConnectionError` (in `services/http.ts`) carrying the friendly service name ("backend service" / "database service"), toasts it via `toastConnectionError`, and rethrows. So every request surfaces "which service is down" in one place, and existing per-call error handling is unaffected. `toastConnectionError` (in `toaster.ts`) uses a `toastId` keyed per service so polling a downed service reuses one toast instead of stacking. Don't add connection-error handling at call sites — it belongs in this one catch.
- **Courses is a sidebar mode, not a separate app.** `Sidebar` declares a `Record<AppMode, { label, Component }>` map (order = segment order: Lectures then Courses) and hands it to `ModeToggle`, which owns the `AppMode` (`'lectures' | 'courses'`) as component state persisted to `localStorage` (`fastStudyMode`, falling back to the default for a stale key), renders the segment buttons from the map, and renders the selected mode's body (`LecturesSidebar` / `CoursesList`) itself — both take no props, each deriving its own selection/navigation via `useMatch` + `useKindParam` + `lectureRoute()`/`courseRoute()`. `CourseView` (the per-course overview feature) refreshes files (database) + status (backend) on mount/course change and on each SSE notify; the backend notifies after every extractor and at run end, so there is no polling. Each extractor shows a single "Generate" button (once its `{slug}.pdf` exists the button becomes a `↺` re-generate control matching MainView's rotate button — it opens a `ConfirmModal` listing the `{slug}.txt/.md/.pdf` that will be rebuilt, then re-runs everything for that slug). The header button reads "Generate All" when nothing exists and "Continue Generating" once any phase of any slug is on disk (`startedSlug(slug, phases, existing)` in `constants/overview.ts` returning non-null over the current files). Either way it fires one `runOverview(course, undefined, undefined, true)` call with `skip_existing=true`, so it never overwrites — it only fills the missing phase outputs (a true continue). There is no warning modal; explicit re-generation (which overwrites) is per-slug (↺) / per-step (↺) only, and those pass no `skipExisting` (defaults false → overwrite). The backend runs the extract→analyze→to_pdf phases sequentially (mirroring the pipeline's Run-All: one trigger, backend schedules, SSE status drives the UI). Each extractor row also has a caret (`useToggleSet`) that expands a per-phase breakdown driven by that extractor's own phases (`stepsFor(extractor.phases)` over `OVERVIEW_STEPS` in `constants/overview.ts`, since `GET /overview/extractors` returns a `phases` array per extractor) — one `file-row` per phase mirroring MainView. Pattern extractors show `{slug}.txt/.md/.pdf`; the immediate `topics` extractor shows only `{slug}.md`(Collect)`/.pdf` with no `.txt`/extract row. ✓/spinner, an open-PDF button on the `.pdf` row only (intermediate `.txt`/`.md` stay link-less), and a per-step `↺` that re-generates from that phase through to_pdf keeping earlier files (`runOverview(course, [slug], phase)` after a ConfirmModal listing the chosen phase + following files). A per-extractor header ✓ still reflects whether the final `.pdf` exists. Run controls gate per-slug, not globally: each slug's Generate/↺ (and per-step ↺) disable on that slug's own `extractors[slug].status === 'running'` (`bs.running`), and the per-step spinner lights on `extractors[slug].phase === step.phase` — so a user can (re)generate one slug while `Generate All` churns on another (multiple overview runs run in parallel per course). Only the header `Generate All`/`Continue Generating` button gates on the aggregate `status.running`. Extractor errors toast once per `(course, extractor, message)` via `useReportOnce`.
- **Pipeline steps are declared once.** `constants/pipeline.ts` is the single source of truth for the step list, prereq chain, action labels, and error labels. Don't hard-code a step name or input file anywhere else — derive from `PIPELINE` / `STEP_*` maps.
- **Single CSS file.** All styles in `index.css` with CSS custom properties. No CSS modules / styled-components.
- **Hebrew rendering.** Folder name labels use `dir="auto"` so the browser auto-detects RTL. Font stack includes Noto Sans Hebrew (Google Fonts) with system fallbacks (Segoe UI, Arial).
- **Toast notifications.** `react-toastify`'s `ToastContainer` is mounted once in `Layout`. Surface non-blocking errors via `toast.error(...)` rather than alerts or inline banners. **UI belongs in components, not contexts / hooks etc.** Contexts and hooks communicate events upward via callbacks (e.g. `sendUpdate(kind, message)`) — callers decide how to render them. Never import `toast` inside a context or hook.
- **tsconfig.** One `tsconfig.json` covers `src/` and `vite.config.ts`.
- **Imports use the `@/` alias for anything under `src/`.** `@/*` maps to `src/*` (configured in `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias`). Write `import x from '@/services/database'`, never `'../../services/database'`. Sibling-only imports (same directory) may stay relative.

## State (App + hooks)

`CourseTreeContext` owns the course tree. The provider holds `courses` state, refreshes on SSE `notify` events, and exposes `{ courses, refreshCourses }` via `useCourseTreeContext()` — no props needed. `Sidebar`, `RefreshCoursesButton`, `NewCourseRow`, `usePendingUpload`, and `MainView` all read from the context directly; `Layout` just wraps the provider. The currently selected lecture's `files` / `transcribePartial` are derived inside `useLectureRoute` from the context's `courses` plus the route params — there is no outlet context.

`useRemoteInflightState({ course, lecture, kind, files, transcribePartial })` reads `RunnerStatusContext` and, if the runner is currently working on the open lecture, returns an inflight descriptor `{ step, startedAt, timingStats, completedFraction, sleepingUntil, progress }`. Callers decide whether a local run preempts this.

`useTimingStats(step, fileSizeBytes)` returns the FastAPI `/timing/{step}` linear-regression estimate, ignoring late responses for `(step, size)` keys the caller has moved on from.

Triggering a run (`runStep` / `runPipeline`) returns `RunInitResult`:

```ts
{ status: 'started' }
{ status: 'busy' }
{ status: 'error'; message: string }
```

Step progress and rate-limit state are not in the trigger result — they arrive via `RunnerStatus.inFlight[]` (`InFlightEntry`, with `sleepingUntil` and `progress`). When a transcribe step is rate-limited the runner sets `sleepingUntil`; `MainView`'s `RateLimitPanel` renders the countdown and `progress.{completed,total}` chunks from that entry rather than treating it as an error.

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

`createClient(baseUrl, serviceName)` builds the per-service HTTP clients used by `backend.ts` and `database.ts`. Centralizes `if (!res.ok) throw httpError(res)` / JSON encoding / `Content-Type` headers, and exposes a `request(...)` escape hatch for endpoints whose behavior intentionally diverges (e.g. `deleteFile`'s fire-and-forget, `uploadVideo`'s bespoke error message, the summary endpoints' "parse JSON regardless of status"). URL/path string building lives in `utils/url.ts`, not here.

### `backend.ts` — FastAPI backend client → `${VITE_API_URL}`

Exposes `runStep`, `runPipeline`, `fetchTimingStats`, `runAll`, `fetchRunnerStatus` (the last two normalize the wire `snake_case` shape to camelCase), plus the course overview feature: `fetchOverviewExtractors`, `runOverview(course, extractors?, fromPhase?, skipExisting?)` (returns `RunInitResult`; omitted extractors = all; `fromPhase` (`extract`|`analyze`|`topics`|`to_pdf`) re-runs that phase through to_pdf keeping earlier files, omitted = full run; `skipExisting=true` adds `skip_existing=true` so the run generates only missing phase outputs per slug — a "continue" that never overwrites — the backend runs the phases sequentially under one per-course lock, like `/run-all`), and `fetchCourseStatus(course)` (returns `{ running, extractors }`; `running` is the aggregate "any slug running", and each `extractors[slug]` entry carries its own `status` + optional `phase` — multiple overview runs can execute in parallel on one course).

### `database.ts` — Database service client → `${VITE_DATABASE_URL}`

Everything filesystem-backed: tree CRUD, course/lecture CRUD, summary read/save/revert, `uploadVideo`, `fileUrl`, `fetchCourseFiles(course)` for the course-level `overview/` area plus `overviewFileUrl(course, file)` (used only to open an extractor's generated PDF in a new tab — no broader file-browser UI), `fetchCourseMeta(course)` (GET `overview/meta`, unwraps `{ meta }` and normalizes each slug's `generated_at` → `generatedAt`; `lectures`/`recitations` stay `{start,end}|null`) driving the slug-row subtitle, and the `databaseUrl` export used to build the SSE EventSource URL in `CourseTreeContext` and `RunnerStatusContext`.

### `toaster.ts` — the only `react-toastify` import site

Nothing else in the codebase imports from `react-toastify`. All toasts go through this service. Exports:

- `toast(kind, message)` where `kind: 'info' | 'error'` — the core helper; `Layout` passes it as `RunnerStatusProvider`'s `sendUpdate(kind, message)` callback to bridge context updates to the toast layer (the context itself does not import this service — UI lives in components).
- `toastConnectionError(err)` — surfaces a `ConnectionError`, keyed by `toastId: conn:<baseUrl>` so a downed service reuses one toast instead of stacking.
- `toastPromise(promise, { pending, success, error })` — `toast.promise` wrapper for fire-and-track async work like `uploadVideo`.
- `toastInitResult(result, { busy, error })` — folds a `RunInitResult` ('started' | 'busy' | 'error') into the right toast; 'started' is a no-op because completion arrives via SSE.
- `ToastContainer` re-export — `Layout` mounts it once. The `react-toastify` CSS is also imported here, not in `main.tsx`.

When you need a new toast shape, add a helper here and import it from this service — do not reach for `toast` directly.

### URL encoding convention

Course / lecture / file names must be `encodeURIComponent`-encoded in URLs to handle Hebrew folder names. Don't call `encodeURIComponent` directly — use the `` path`` `` tagged template in `utils/url.ts`, which encodes every interpolated value by default (`` path`/courses/${course}` ``). Its output is already encoded, so never feed `path` (or `lectureBase`, built from it) back into another `path` — that double-encodes. `kind === 'recitation'` is appended as `?kind=recitation` via the shared `kindQuery` helper, also in `utils/url.ts`.
