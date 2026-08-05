# CLAUDE.md — frontend

React + Vite + TypeScript SPA driving the lecture pipeline. It talks to the FastAPI backend (:8000) for
runs and to the database service (:8001) for all filesystem state; the Vite dev server only serves the SPA.

## Running

```bash
npm run dev      # localhost:5173
npm run build    # tsc -b && vite build → dist/
npm run test     # vitest run (config lives in vite.config.ts; `test:watch` for watch mode)
```

`.env` (not committed): `VITE_API_URL` (default `http://localhost:8000`), `VITE_DATABASE_URL`
(`http://localhost:8001`), `VITE_AUTODL_URL` (`http://localhost:3053`), `VITE_DOWNLOADER_URL`
(`http://localhost:3052`).

## Docs

| Doc                       | Covers                                                                       |
| ------------------------- | ---------------------------------------------------------------------------- |
| `docs/architecture.md`    | layering, `@/` alias, routing, SSE refresh model, sidebar modes, styling     |
| `docs/services.md`        | the boundary rule, http client + ConnectionError, each service, URL encoding |
| `docs/lectures.md`        | pipeline constants, runner/in-flight state, edit view, sidebar tree          |
| `docs/course-overview.md` | extractors, phases, generate/continue/re-generate, per-slug gating           |
| `docs/downloads.md`       | auth, discovery, row edits, bulk queue, passcode gate                        |
| `docs/search.md`          | in-memory corpus, find → group → build phases, overlap merge, Hebrew boundaries |

There are no sub-services under `frontend/` — this is the only CLAUDE.md.

## Rules

- Each file under `services/` is the single boundary for one external concern — no raw `fetch`,
  `EventSource` or `react-toastify` at call sites.
- Derive steps from `features/lectures/constants/pipeline.ts`; build URLs with `shared/utils/url.ts`.
- UI lives in components, not contexts or hooks — those expose state and callbacks only.
- Import via `@/` for anything outside the current directory; siblings may be relative.
- Tests are vitest `*.test.ts` colocated with the pure logic they cover; there is no DOM test setup.

## Documentation style

Root `CLAUDE.md` covers the general rules. Frontend-specific: architecture belongs in `docs/`, and when a change makes these docs stale, update them in the same pass.

## React Best Practices

- Hooks and functions must return a narrow surface. A hook returning more than ~5 fields is a design smell — split it or reconsider the boundary. Similarly, a component with more than ~5 props is a design smell.
