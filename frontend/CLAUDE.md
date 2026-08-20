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
| `docs/ARCHITECTURE.md`    | layering, `@/` alias, routing, SSE refresh model, mode toggles, styling      |
| `docs/SERVICES.md`        | the boundary rule, http client + ConnectionError, each service, URL encoding |
| `docs/LECTURES.md`        | pipeline constants, materials, runner/in-flight state, edit view, sidebar tree |
| `docs/COURSE-OVERVIEW.md` | extractors, phases, generate/continue/re-generate, per-slug gating           |
| `docs/DOWNLOADS.md`       | auth, discovery, videos/materials toggle, row edits, reflected bulk run, passcode |
| `docs/SEARCH.md`          | in-memory corpus, find → group → build phases, overlap merge, Hebrew boundaries |
| `docs/I18N.md`            | translated chrome vs. untranslated data, the extract loop, RTL logical properties |

There are no sub-services under `frontend/` — this is the only CLAUDE.md.

## Rules

- Each file under `services/` is the single boundary for one external concern — no raw `fetch`,
  `EventSource` or `react-toastify` at call sites.
- Derive steps from `features/lectures/constants/pipeline.ts`; build URLs with `shared/utils/url.ts`.
- Every user-facing string goes through a Lingui macro, and every direction-sensitive CSS declaration
  is a logical property. See `docs/I18N.md` — including what deliberately stays untranslated.
- UI lives in components, not contexts or hooks — those expose state and callbacks only.
- Import via `@/` for anything outside the current directory; siblings may be relative.
- Tests are vitest `*.test.ts` colocated with the pure logic they cover. The only shared setup is
  `src/test-setup.ts`, which activates the English catalog; a test needing a DOM opts in per file with
  a `// @vitest-environment jsdom` docblock.
- A component's styles live in `X.css` beside `X.tsx`, or in a named `src/styles/*.css` when 2+ components
  share the class; every component imports every stylesheet that affects it. There is no global stylesheet
  beyond `styles/tokens.css`, and cross-file rules disambiguate by specificity, never source order.

## Documentation style

Root `CLAUDE.md` covers the general rules. Frontend-specific: architecture belongs in `docs/`, and when a change makes these docs stale, update them in the same pass.

## React Best Practices

- Hooks and functions must return a narrow surface. A hook returning more than ~5 fields is a design smell — split it or reconsider the boundary. Similarly, a component with more than ~5 props is a design smell.
