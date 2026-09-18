# Architecture

## Two backends, no Vite backend

The SPA calls the FastAPI backend (:8000) for runs and timing stats and the database service (:8001) for
everything filesystem-backed; the Vite dev server hosts no API. The browser never reads `DATA_ROOT`, so
never add a backend endpoint answering "does file X exist" — that is the database service's job.

## Layering

| Dir                      | Rule                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| root (`App`, `types.ts`) | flat, no subdirs                                                                                 |
| `styles/`                | `tokens.css` plus the shared-vocabulary stylesheets — see Styling                                |
| `app/`                   | the shell: `Layout` (providers, sidebar, outlet, Drive consent prompt), `InitGate`, error boundary |
| `services/`              | one file per external concern, shared by all features, never split per feature                   |
| `shared/`                | building blocks with cross-feature consumers (components, contexts, hooks, utils, sidebar shell) |
| `features/<x>/`          | one slice per page: views, layout routes, components, hooks, contexts, constants, utils          |

A primitive lives in `features/<x>/components` until a second feature needs it, then moves to `shared/`.

**UI belongs in components.** Contexts and hooks hold state and expose callbacks; they never render toasts
and never import `react-toastify`. A context that must surface a message takes a `sendUpdate(kind,
message)` callback (`Layout` passes `toast`) or returns a result its caller toasts. A provider that owns a
modal (`PendingUploadProvider`) renders it itself.

## SSE-driven refresh

The database service owns one notify channel. `services/events.ts` opens a single `EventSource` on the
first subscriber and closes it on the last; `useNotify(cb)` is the only interface. `CourseTreeContext`,
`RunnerStatusContext` and `CourseOverviewContext` refresh on notify — nothing polls. The backend notifies
on every meaningful state change, and the downloader after a download.

The downloader server has its own stream, reflected by `DownloadJobsProvider` and `SectionRunsProvider`
([JOBS.md](JOBS.md), [BULK.md](BULK.md)): a contentless ping plus one snapshot fetch per ping and per
connect, since the stream itself is memoryless.

A fetcher that a notify burst can re-trigger wraps its promise in `useLatestRequest()`, which settles only
the newest call (superseded ones resolve `undefined`, even on failure) so a late answer cannot overwrite a
fresher one.

## Routes

`react-router-dom` v7, declared in `App.tsx` from the patterns in `shared/utils/routes.ts` (also what
`useMatch`/`matchPath` take). Every route renders inside `Layout`; `/`, the overview and
`/:course/:lecture` also sit under the pathless `LecturesLayout`, which adds the tree pane.

| Path                       | View              |
| -------------------------- | ----------------- |
| `/`                        | empty state       |
| `/course/:course/overview` | `CourseView`      |
| `/downloads`               | `DownloadsView`   |
| `/search`                  | `SearchView`      |
| `/running`                 | `RunnerView`      |
| `/settings`                | `SettingsView`    |
| `/:course/:lecture`        | `MainView`        |
| `/:course/:lecture/edit`   | `EditSummaryView` |

`kind` is the query param `?kind=recitation`, propagated everywhere, never a segment. The static segments
outrank `/:course/:lecture` in v7 ranking, and a pathless layout adds no segment. The overview is three
segments rather than `/course/:course`, which would outrank `/:course/:lecture` and hide every lecture of a
course named `course`.

The sidebar's five rows are all routes and exactly one is active per page: the four static routes claim
their own, Lectures claims the rest. Leaving `/downloads` unmounts its view, so `Layout` also mounts the
downloads providers, and discovery, edits, jobs and runs outlive the route ([DOWNLOADS.md](DOWNLOADS.md)).

Route params are user-editable, so `MainView`, `EditSummaryView` and `CourseView` resolve them against
`CourseTreeContext` first: spinner until `loaded`, then `NotFoundPanel` (`shared/utils/notFound.ts`).
`loaded` exists because an unresolved param and an unfetched tree both look empty, so a typo would spin
forever; it flips only when a tree actually lands or the fetch fails, never on a superseded response.
`CourseView` checks above `CourseOverviewProvider`, so a nonexistent course issues no overview requests.

`app/InitGate` wraps the route table and shows the first-run wall until the required settings exist
([SETTINGS.md](SETTINGS.md)).

## Error boundary

`app/ErrorBoundary` wraps `<App/>` inside `BrowserRouter`, so a render error anywhere below becomes a
fallback (timestamp, URL, user agent, both stacks, a copy button) instead of a blank page. It is keyed on
`location.pathname`: the fallback replaces the sidebar too, so its Home link is the only way out and only a
remount clears the error. Malformed escapes like `/a%/b` never reach it — the host rejects them first.

**Send report** goes through `services/report.ts` to the bridge, which writes the report and launch-log
tail under the state root and opens a truncated `mailto:` (`electron/docs/RENDERER.md`). File and mail fail
independently, so all four outcomes are reported **in place, never as a toast** — the fallback has
replaced the `App` that mounts the `ToastContainer`. It renders only when the bridge exists: browser dev
has no version or launch log worth mailing.

## Mode toggles

`shared/components/ModeToggle<M>({ modes, storageKey, className?, children? })` is the segmented switch,
its mode persisted in `localStorage`. The insertion order of `modes` is both segment order and default,
and an unknown stored key falls back to it. A mode names a zero-prop `Component`, or the caller passes
`children(mode, selectMode)` — `selectMode` lets the body switch segments itself (the paused-runs banner).
A mode may carry a `count`.

`.mode-toggle` is styled for the dark sidebar; `.mode-toggle--light` is the same control on a light
surface, shared by the downloads segments and each recording's kind toggle so they read as one family.
`LanguageSwitcher` reuses the dark CSS without the component.

## Styling

Plain global CSS whose class names are byte-identical to the `className` strings, so one grep hits markup
and rule. A component's CSS is `X.css` beside `X.tsx`. A class two or more components render lives in a
named `src/styles/` stylesheet, and **every component using it imports it** rather than relying on a
parent — Vite dedupes, and a component's imports stay the exhaustive list of what can style it.
`styles/tokens.css` is the only global sheet (reset, `html/body/#root`, custom properties, no class
selector), and `main.tsx` imports only it and the fonts; `.claude/hooks/lint.sh` enforces both, plus the
absence of a root `index.css`.

Every colour, size and space step resolves to a `tokens.css` property, whose comments give each its role.
The accent never fills a control on a light surface, where it fails contrast: a filled button is `--ink`,
the accent is text, border or tint, and `--accent-on-dark` serves the two dark surfaces. Fonts are
self-hosted through `@fontsource` so the app renders offline; Heebo is Hebrew-first, JetBrains Mono carries
filenames, counts and durations.

`.btn` + `--primary`/`--ghost`/`--danger` is the whole button vocabulary, `.chip` + five colour variants
the whole state-label vocabulary, and `StatusNode` the six run states (`done`, `running`, `pending`,
`paused`, `failed`, `quota`) at one size. `PageHeader` opens every full-page view with one primary action, and
`.pipeline-card` holds its rows on the lecture and overview pages. The toast surface is skinned in
`services/toaster.css`.

**No cross-file rule may depend on source order.** Vite's import order differs between dev (per-module
`<style>` tags) and prod (one concatenated sheet), so equal-specificity rules resolve unpredictably;
disambiguate by specificity. Where two rules genuinely collide at equal specificity (`.pipeline-row` /
`.pipeline-row--running`), both live in one file in winning order with a comment — why a few single-user
classes sit in a shared sheet. Verify a suspected collision against the built bundle.

User-supplied text renders with `dir="auto"` ([I18N.md](I18N.md)).

## Smoke-suite test ids

`data-testid`s exist only as a contract for `delivery/smoke/`, which drives the packaged app and never
reads visible text. Renaming, removing or re-scoping one is a smoke-suite change; add none for anything
else. A value the suite asserts on rides a `data-*` attribute spelled as the code's enum, never a
translated string.

| id                            | extra attributes                                                                                                         | component                                                   | marks                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------- |
| `init-wall`                   | —                                                                                                                        | `features/settings/InitWall.tsx`                            | the first-run wall's root                       |
| `init-wall-submit`            | —                                                                                                                        | `features/settings/InitWall.tsx`                            | its save button (`disabled` until complete)     |
| `api-key-input`               | `data-provider`: `gemini` \| `groq`                                                                                      | `features/settings/components/ApiKeyField`                  | a key input, wall and `/settings`               |
| `api-key-status`              | `data-provider`; `data-status`: `prefix` \| `checking` \| `valid` \| `rejected` \| `unverified`, absent when blank       | `features/settings/components/ApiKeyField`                  | that key's probe line                           |
| `data-root-input`             | —                                                                                                                        | `features/settings/components/DataRootField`                | the data folder input, wall and `/settings`     |
| `data-root-confirm`           | —                                                                                                                        | `features/settings/components/DataRootField`                | the wall-only confirm checkbox                  |
| `browser-prereq`              | `data-status`: `checking` \| `available` \| `missing` \| `unknown`; `data-channel`: `chrome` \| `msedge` when available  | `features/settings/components/BrowserPrereqField`           | the browser prerequisite, wall and `/settings`  |
| `browser-prereq-install-link` | —                                                                                                                        | `features/settings/components/BrowserPrereqField`           | the install link, rendered only when missing    |
| `lecture`                     | `data-course`, `data-lecture`; `data-kind`: `lecture` \| `recitation`                                                    | `features/lectures/sidebar/tree/LectureItem`                | a tree pane lecture row                         |
| `lecture-view`                | `data-course`, `data-lecture`, `data-kind`                                                                               | `features/lectures/MainView.tsx`                            | the lecture page's root                         |
| `step-status`                 | `data-step`: `audio` \| `transcribe` \| `summarize` \| `pdf` \| `drive`; `data-status`: `done` \| `running` \| `pending` | `features/lectures/MainView.tsx`                            | one pipeline row that has a step                |
| `lecture-error`               | —                                                                                                                        | `features/lectures/MainView.tsx`                            | the lecture's last run error                    |
| `lecture-error-message`       | —                                                                                                                        | `features/lectures/MainView.tsx`                            | that error's service prose, untranslated        |
| `lecture-actions-menu`        | —                                                                                                                        | `features/lectures/components/LectureActionsMenu`           | the overflow trigger that reveals `open-pdf`    |
| `open-pdf`                    | —                                                                                                                        | `features/lectures/MainView.tsx` (via `LectureActionsMenu`) | "Open PDF", through `services/open.ts`'s bridge |
| `drive-consent-modal`         | —                                                                                                                        | `app/DriveConsentPrompt.tsx`                                | the Drive consent modal's body                  |
