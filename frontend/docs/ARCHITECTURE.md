# Architecture

## Two backends, no Vite backend

The SPA talks to the FastAPI backend (:8000) for pipeline runs and timing stats, and to
the database service (:8001) for everything filesystem-backed. The Vite dev server
only serves the SPA — it hosts no API. The browser never reads `DATA_ROOT`; after a step succeeds, the
tree is re-fetched from the database service.

Corollary: never add a backend endpoint to answer "does file X exist" — that is the database service's job.

## Layering

| Dir                      | Rule                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| root (`App`, `types.ts`) | flat, no subdirs                                                                                 |
| `styles/`                | `tokens.css` plus the shared-vocabulary stylesheets — see Styling                                |
| `app/`                   | the shell (`Layout`) — mounts providers, sidebar, outlet, toast container                        |
| `services/`              | one file per external concern, shared by all features, never split per feature                   |
| `shared/`                | building blocks with cross-feature consumers (components, contexts, hooks, utils, sidebar shell) |
| `features/<x>/`          | one slice per mode/page: views, sidebar body, components, hooks, contexts, constants, utils      |

A primitive lives in `features/<x>/components` until a second feature needs it; then it moves to `shared/`.
A feature may own a service (`features/downloads/services/autoDownloader.ts`, `downloadServer.ts`) when the concern is its alone.

Imports across directories use the `@/` alias (`@/*` → `src/*`, set in both `tsconfig.json` and
`vite.config.ts`). Only same-directory siblings may be relative.

## UI belongs in components

Contexts and hooks hold state and expose callbacks; they never render toasts or modals and never import
`react-toastify`. A context that needs to surface a message takes a `sendUpdate(kind, message)` callback
(`Layout` passes `toast`), or returns a result the calling component toasts itself. Providers that own a
modal (`PendingUploadProvider`) render it themselves so consumers never juggle a returned node.

## SSE-driven refresh

The database service owns one notify channel. `services/events.ts` opens a single `EventSource` lazily on
the first subscriber and ref-counts it closed on the last; `useNotify(cb)` is the only interface.
`CourseTreeContext`, `RunnerStatusContext` and `CourseOverviewContext` all refresh on notify — nothing
polls. The backend fires a notify on every meaningful state change, and the downloader POSTs
`${database}/notify` after a download, so a completed download updates the UI live.

The downloader server has its own, separate stream (`GET /events`, opened through `downloadServer.ts` by
`DownloadJobsProvider` for a download's start and end, and by `SectionRunsProvider` for a section run's
transitions). It is push-only too; the fetches beside it, `GET /jobs` and `GET /runs`, run once per connect
to give the memoryless stream a starting state (see `DOWNLOADS.md`).

Any fetcher that can be re-triggered by a notify burst wraps its promise in `useLatestRequest()`, which
resolves only the newest call (superseded ones resolve `undefined`) so a late response can't overwrite a
fresher one.

## Routes

`react-router-dom` v7, declared in `App.tsx`; every route renders inside `Layout`.

| Path                     | View              |
| ------------------------ | ----------------- |
| `/`                      | empty state       |
| `/course/:course`        | `CourseView`      |
| `/downloads`             | `DownloadsView`   |
| `/search`                | `SearchView`      |
| `/running`               | `RunnerView`      |
| `/settings`              | `SettingsView`    |
| `/:course/:lecture`      | `MainView`        |
| `/:course/:lecture/edit` | `EditSummaryView` |

`kind` (lecture vs recitation) is a query param `?kind=recitation`, propagated everywhere rather than
being a route segment. The static `course`/`downloads`/`search`/`settings`/`running` segments outrank the dynamic
`/:course/:lecture` pattern in v7 ranking, so they never collide.

`/downloads`, `/search` and `/settings` are three of the sidebar's five nav rows, and the only ones that are routes —
Lectures and Courses swap the tree below without navigating. `/running` is the sixth destination and
is reached only from the one-line row at the head of the lectures tree, which owns its own active
state; the nav rows treat it as a route, so neither tree row reads as active while it is up. Clicking anything in that tree navigates
away from `/downloads`, which is the intended "exit on sidebar click". Because that unmounts
the view, `Layout` mounts `DownloadJobsProvider` and `DownloadsSessionProvider` alongside `CourseTreeProvider`
and `RunnerStatusProvider`, so the page's discovery, edits, in-flight bulk runs and download jobs all outlive
the route (see `DOWNLOADS.md`).

Route params are user-editable and may name nothing on disk, so the three tree-backed views
(`MainView`, `EditSummaryView`, `CourseView`) resolve their params against `CourseTreeContext` before
rendering: spinner until `loaded`, then `NotFoundPanel` with a message from `shared/utils/notFound.ts`.
That flag exists because an unresolved param and an unfetched tree both look like an empty tree —
without it a typo'd URL is indistinguishable from loading and spins forever. `loaded` flips only when a
tree actually lands (or the fetch fails) — never on a response superseded by a newer one, which would
briefly expose the still-empty tree as "not found". `CourseView` runs the check
above `CourseOverviewProvider` so a nonexistent course issues no overview requests.

`app/InitGate` wraps the whole route table: it reads the settings store once at boot and, until the
required entries are filled, renders the first-run wall in place of the app — no sidebar, no route,
no way past (see `SETTINGS.md`).

`app/ErrorBoundary` wraps `<App/>` inside `BrowserRouter` — a render error anywhere below it (views,
`Layout`, providers, sidebar) would otherwise unmount the tree into a blank page. The fallback shows
timestamp, URL, user agent, stack and component stack with a copy button, so a crash can be reported
without devtools. It is keyed on `location.pathname`: the fallback replaces the sidebar too, so its
Home link is the only way out, and only a remount clears the error state. Reload stays as the hard
reset for a crash that reproduces at `/`. Malformed URLs like `/a%/b` never reach it — the dev server
and any static host reject the bad escape before React loads, and react-router's own `decodePath`
warns and passes undecoded segments through to the not-found path above.

## Mode toggles

`shared/components/ModeToggle` is the generic segmented switch: `ModeToggle<M>({ modes, storageKey,
className?, children? })`. It owns the mode as component state persisted in `localStorage` under
`storageKey`; insertion order of `modes` is both the segment order and the default, and an unknown
stored key falls back to that default. A mode either names a zero-prop `Component` or the caller passes
`children(mode, selectMode)` when it needs the selected value rather than a body — `selectMode` lets the body
switch segments itself, which is how the downloads passcode banner jumps to a stuck section. A mode may
also carry a `count`, shown beside its label.

`DownloadsView` uses the `children` form with `Record<Media, …>` and key `fastStudyDownloadsMedia`,
since it filters items by the selected media, and counts each segment's items. `.mode-toggle` is styled
dark for the sidebar; `.mode-toggle--light` is the same control on a light surface — a sunken track under
a raised white pill — worn by the downloads segments and by each recording card's Lecture/Recitation
toggle, so the two read as one control family. `LanguageSwitcher` reuses the dark CSS without the component.

`Sidebar` is the other `AppMode` holder, but not through `ModeToggle`: its Lectures and Courses nav
rows own the mode themselves, still persisted under `fastStudyMode` so an existing choice survived the
switch away from the segmented control.

## Styling

Plain CSS, no modules and no styled-components — class names are global and byte-identical to the
`className` strings, so one grep for a class hits both its markup and its rule.

A component's CSS lives in `X.css` beside `X.tsx` and is imported by it. A class rendered by two or more
components instead lives in a named shared-vocabulary stylesheet under `src/styles/` — `button`, `chip`,
`modal`, `pane-header`, `panel`, `pipeline-card`, `segmented`, `source-row`, `sidebar-tree`, `spinner` — and **every component
using that class imports the stylesheet**, never relying on a parent to import on its behalf. Vite dedupes
repeated imports, so this costs nothing and keeps a component's import list an exhaustive list of what can
style it. A file earns a place in `src/styles/` only by having multiple component users; that is a fact you
can regenerate by grepping `className` across `src/`.

`src/styles/tokens.css` is the only global stylesheet: the reset, `html/body/#root`, and the `:root` custom
properties. It holds no class selector, and `main.tsx` imports it and the font weights and nothing else.
`.claude/lint.sh` enforces both, plus the absence of a root `index.css`.

### The token layer

Every colour, size and spacing step in `src/**/*.css` resolves to a `tokens.css` custom property. The
scales are:

| Group     | Tokens                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| surfaces  | `--bg` (app canvas), `--surface` (cards), `--surface-sunken` (a row mid-run)                                                |
| text      | `--text` → `--text-4`, darkest to faintest                                                                                  |
| lines     | `--line`, `--line-soft`, `--control-line` (input and button borders)                                                        |
| primary   | `--ink` — the one filled button per page                                                                                    |
| accent    | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-line`, `--accent-ink`, `--accent-on-dark`                          |
| status    | `--ok`/`--ok-soft`/`--ok-surface`/`--ok-line`/`--ok-dot`, `--warn`/`--warn-soft`, `--danger`/`--danger-soft`, `--highlight` |
| sidebar   | `--sidebar-bg`, `--sidebar-raise`, `--sidebar-line`, `--sidebar-fg`, `--sidebar-muted`, `--sidebar-dim`, `--sidebar-width`  |
| space     | `--space-1` 4px → `--space-8` 40px                                                                                          |
| radius    | `--r-sm` 8px, `--r` 9px, `--r-lg` 12px, `--r-xl` 14px, `--r-pill`                                                           |
| type      | `--font-ui`, `--font-mono`, `--fs-title` 26 → `--fs-fine` 11                                                                |
| elevation | `--shadow-sm`, `--shadow-md` (toasts), `--shadow-lg` (modals)                                                               |

The accent never fills a control on a light surface, where it fails contrast: a filled button is `--ink`,
and the accent appears as text, a border or a soft tint. `--accent-on-dark` is its counterpart on the
sidebar, which is the only dark surface. No hardcoded colour is left in `src/**/*.css`.

Fonts are self-hosted through `@fontsource`, imported per weight from `main.tsx`, so the app renders
correctly with no network. Heebo is Hebrew-first, so Hebrew and Latin share one ramp instead of falling
back mid-string; JetBrains Mono carries filenames, counts and durations.

### Shared primitives

`.btn` plus `--primary` / `--ghost` / `--danger` is the whole button vocabulary; `.chip` plus its five
colour variants is the whole state-label vocabulary. `StatusNode` renders the four run states (`done`,
`running`, `pending`, `failed`) at one size, and is what the lecture pipeline, the course branches and
their steps all read from. `PageHeader` opens every full-page view — title, metadata row, one primary
action — and `.pipeline-card` is the card its rows sit in, on the lecture pipeline and the course
overview alike. `ConfirmModal`, `ProgressBar` and the `.empty-state` card are the other cross-feature
pieces. The react-toastify surface is skinned once in `services/toaster.css`, beside the only
file that imports the library.

**No cross-file rule may depend on source order.** Import order follows Vite's module graph and differs
between dev (per-module `<style>` tags) and prod (one extracted, concatenated sheet), so two same-specificity
rules that used to resolve by position now resolve unpredictably. Disambiguate by specificity. Where two
rules genuinely collide on the same element at equal specificity — `.lecture-list` / `.course-list`,
`.pipeline-row` / `.pipeline-row--running` — both live in one file in the
winning order, with a comment naming the dependency; that is why a few single-user classes sit in a shared
stylesheet. Verify a suspected collision against the built bundle, not the dev server.

Any user-supplied text (course, lecture, section, recording titles) renders with `dir="auto"` so Hebrew
resolves RTL per element.
