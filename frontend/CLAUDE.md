# CLAUDE.md — frontend

React + Vite + TypeScript SPA driving the lecture pipeline. It talks to the FastAPI backend (:8000) for
runs and to the database service (:8001) for all filesystem state; the Vite dev server only serves the SPA.

## Running

```bash
npm run dev      # localhost:5173
npm run build    # tsc -b && vite build → dist/
npm run test     # vitest run (config lives in vite.config.ts; `test:watch` for watch mode)
```

The frontend reads no env var. The four service base URLs come from the Electron preload bridge at
runtime (`services/runtime.ts`), falling back to the dev ports `:8000`, `:8001`, `:3052` and `:3053`. The
same bridge carries the launch secret every request sends as `X-FastStudy-Secret`; it is absent in browser
dev, where the services enforce nothing. It also reports whether this machine can store the API keys at all
(`canStoreApiKeys`) — see `docs/SETTINGS.md`.

## Verifying layout changes

Check layout/CSS work against the **real page**, not a hand-built HTML harness: start `npm run dev` on a
spare port, drive it with Playwright, and fulfil the service calls from the test script — `/settings` (the
InitGate wall gates everything behind it), `/tree`, `/auth/status`, `/list`. Stubbing at the browser poses
any data shape, including ones no local course has, without booting four services or writing to `DATA_ROOT`.
Measure with `getBoundingClientRect` whenever the claim is "aligned" or "centred", and screenshot every
row/card shape — a grid that fixes the wide window can overlap at a narrow one.

Use **one** `page.route("**/*")` handler that lets the dev-server origin `continue_()` and answers
everything else by URL suffix. A narrower glob like `**/list` or `**/events*` also matches Vite's own module
URLs (`/src/services/events.ts`), and aborting one blanks the app with no console error.

A new UI state — a notice, a disabled control, an empty state — needs a stable selector, and the report
naming a change has to name it: the user checks frontend work by querying the live DOM over CDP in the real
Electron app, so a state with no stable hook cannot be asserted on. Prefer an element's existing `id`
(`#key-gemini`, `#key-groq` on the API key inputs); there is no `data-testid` convention here. Where nothing
stable exists, add a modifier class — `.settings-note--no-key-storage` on the secure-storage warning.

## Docs

| Doc                       | Covers                                                                            |
| ------------------------- | --------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md`    | layering, `@/` alias, routing, SSE refresh model, mode toggles, styling           |
| `docs/SERVICES.md`        | the boundary rule, http client + ConnectionError, each service, URL encoding      |
| `docs/LECTURES.md`        | pipeline constants, lecture view, materials, in-flight state, edit view, sidebar  |
| `docs/COURSE-OVERVIEW.md` | extractors, phases, generate/continue/re-generate, per-slug gating                |
| `docs/DOWNLOADS.md`       | layout, auth, discovery, media segments, row edits, reflected bulk run, passcode  |
| `docs/SETTINGS.md`        | the settings entries, the first-run wall, the `/settings` route, key validation   |
| `docs/SEARCH.md`          | in-memory corpus, find → group → build phases, overlap merge, Hebrew boundaries   |
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
- Every colour, size and space step comes from a `styles/tokens.css` custom property — no new hex, no
  off-scale padding. The one exception is a colour mirroring another service's constant, which carries a
  comment naming its source (`MarkdownEditor.css`'s callout tints). Buttons are `.btn` + a variant, state
  labels are `.chip` + a variant, and run state is `StatusNode`. See `docs/ARCHITECTURE.md` §Styling.

## Documentation style

Root `CLAUDE.md` covers the general rules. Frontend-specific: architecture belongs in `docs/`, and when a change makes these docs stale, update them in the same pass.

## React Best Practices

- Hooks and functions must return a narrow surface. A hook returning more than ~5 fields is a design smell — split it or reconsider the boundary. Similarly, a component with more than ~5 props is a design smell.
