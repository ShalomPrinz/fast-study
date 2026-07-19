# CLAUDE.md — frontend

React + Vite + TypeScript SPA driving the lecture pipeline. It talks to the FastAPI backend (:8000) for
runs and to the database service (:8001) for all filesystem state; the Vite dev server only serves the SPA.

## Running

```bash
npm run dev      # localhost:5173
npm run build    # tsc -b && vite build → dist/   (run this to surface type errors)
```

`.env` (not committed): `VITE_API_URL` (default `http://localhost:8000`), `VITE_DATABASE_URL`
(`http://localhost:8001`), `VITE_AUTODL_URL` (`http://localhost:3053`).

## Docs

| Doc                          | Covers |
|------------------------------|--------|
| `docs/architecture.md`       | layering, `@/` alias, routing, SSE refresh model, sidebar modes, styling |
| `docs/services.md`           | the boundary rule, http client + ConnectionError, each service, URL encoding |
| `docs/lectures.md`           | pipeline constants, runner/in-flight state, edit view, sidebar tree |
| `docs/course-overview.md`    | extractors, phases, generate/continue/re-generate, per-slug gating |
| `docs/downloads.md`          | auth, discovery, row edits, bulk queue, passcode gate |

There are no sub-services under `frontend/` — this is the only CLAUDE.md.

## Directory layout

```
src/
  App.tsx  main.tsx  index.css  types.ts      routes, entry, single stylesheet, domain types
  app/Layout.tsx                              providers + sidebar + outlet + ToastContainer
  services/                                   http, backend, database, events (SSE), toaster
  shared/                                     components, contexts (CourseTree, RunnerStatus),
                                              hooks, utils (url, format, inFlightKey), sidebar shell
  features/lectures/                          MainView, EditSummaryView, sidebar tree, pipeline constants
  features/course-overview/                   CourseView, extractor rows, overview constants
  features/downloads/                         DownloadsView, recording rows, autoDownloader service
```

## Rules

- Each file under `services/` is the single boundary for one external concern — no raw `fetch`,
  `EventSource` or `react-toastify` at call sites.
- Derive steps from `features/lectures/constants/pipeline.ts`; build URLs with `shared/utils/url.ts`.
- UI lives in components, not contexts or hooks — those expose state and callbacks only.
- Import via `@/` for anything outside the current directory; siblings may be relative.
- Verify with `npm run build`.

## Documentation style

- Docs and comments describe the **current state** and the durable WHY — never plans, phased steps, or
  "how we got here" history. When a plan ships, fold what's durable into the docs and drop the narrative.
- Comments describe what a function does and the idea behind it, plus the non-obvious WHY when there is
  one. Never restate what the code already says, and don't comment everywhere — that's noise.
- Keep it short. One line is the default, two the maximum.
- Architecture belongs in `docs/`; inline comments stay to small technical details (two lines max).
- When a change makes these docs stale, update them in the same pass.
