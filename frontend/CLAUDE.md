# CLAUDE.md — frontend

React + Vite + TypeScript SPA driving the lecture pipeline. It calls the FastAPI backend (:8000) for runs,
the database service (:8001) for all filesystem state, and the two downloader services (:3052, :3053) for
the downloads page; the Vite dev server only serves the SPA.

## Running

```bash
npm run dev      # localhost:5173
npm run build    # tsc -b && vite build → dist/
npm run test     # vitest run
npm run extract  # update the Lingui catalogs — see docs/I18N.md
```

The frontend reads no env var. Service URLs, the launch secret and everything else packaged come from the
Electron preload bridge (`services/runtime.ts`), falling back to the dev ports — see
[docs/SERVICES.md](docs/SERVICES.md).

## Docs

| Doc                                        | Covers                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)    | layering, SSE refresh, routes, error boundary, mode toggles, styling, test ids    |
| [SERVICES.md](docs/SERVICES.md)            | the boundary rule, http client and errors, each service, the bridge, URL encoding |
| [LECTURES.md](docs/LECTURES.md)            | pipeline constants, lecture view, materials, runner state, sidebar, tree pane     |
| [EDITOR.md](docs/EDITOR.md)                | the summary editor: save cycle, `PdfViewer`, `MarkdownEditor`                     |
| [OVERVIEW.md](docs/OVERVIEW.md)            | course overview: extractors, generate/continue/re-generate, per-slug gating       |
| [DOWNLOADS.md](docs/DOWNLOADS.md)          | downloads page: auth, session, discovery, row edits, already-downloaded rule      |
| [JOBS.md](docs/JOBS.md)                    | following a download: the jobs reflection, grouping by `ref`, bars, retry         |
| [BULK.md](docs/BULK.md)                    | a section's "Download all": the reflected run, derived outcome, passcode          |
| [SETTINGS.md](docs/SETTINGS.md)            | the settings, the store, the first-run wall, prerequisites, accounts, Drive consent |
| [SEARCH.md](docs/SEARCH.md)                | client-side corpus, find → group → build, snippets, paging                        |
| [I18N.md](docs/I18N.md)                    | translated chrome vs. untranslated data, the extract loop, RTL                    |
| [TESTING.md](docs/TESTING.md)              | vitest conventions, verifying layout with Playwright, stable selectors            |

There are no sub-services under `frontend/` — this is the only CLAUDE.md.

## Rules

- Each file under `services/` is the single boundary for one external concern — no raw `fetch`,
  `EventSource` or `react-toastify` at call sites.
- Open every file and outside link through `services/open.ts` — never `window.open`, `target="_blank"` or
  an outside `href` without `preventDefault()`. Packaged, the first two do nothing; the last loads the site
  in the app window, secret included.
- Derive steps from `features/lectures/constants/pipeline.ts`; build URLs with `shared/utils/url.ts`;
  route patterns come from `shared/utils/routes.ts`.
- Every user-facing string goes through a Lingui macro, and every direction-sensitive CSS declaration is a
  logical property ([docs/I18N.md](docs/I18N.md)).
- UI lives in components, not contexts or hooks — those expose state and callbacks only.
- Import via `@/` (`src/*`, set in `tsconfig.json` and `vite.config.ts`) for anything outside the current
  directory; siblings may be relative.
- Tests assert decisions, never markup, CSS or translated copy; a UI-state bug fix moves the deciding
  logic into a pure function and tests it in the same change ([docs/TESTING.md](docs/TESTING.md)).
- A new UI state needs a stable selector; `data-testid` is reserved for the smoke suite
  ([docs/TESTING.md](docs/TESTING.md)).
- A component's styles live in `X.css` beside `X.tsx`, or in a named `src/styles/*.css` when 2+ components
  share the class; every component imports every stylesheet that affects it. There is no global stylesheet
  beyond `styles/tokens.css`, and cross-file rules disambiguate by specificity, never source order.
- Every colour, size and space step comes from a `styles/tokens.css` custom property — no new hex, no
  off-scale padding. The one exception mirrors another service's constant and names its source in a
  comment (`MarkdownEditor.css`'s callout tints). Buttons are `.btn` + a variant, state labels `.chip` + a
  variant, run state `StatusNode` ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §Styling).
- Hooks and components keep a narrow surface: more than ~5 returned fields or ~5 props is a design smell —
  split it or reconsider the boundary.
- When a change makes these docs stale, update them in the same pass.
