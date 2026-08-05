# Architecture

## Two backends, no Vite backend

The SPA talks to the FastAPI backend (`VITE_API_URL`, :8000) for pipeline runs and timing stats, and to
the database service (`VITE_DATABASE_URL`, :8001) for everything filesystem-backed. The Vite dev server
only serves the SPA — it hosts no API. The browser never reads `DATA_ROOT`; after a step succeeds, the
tree is re-fetched from the database service.

Corollary: never add a backend endpoint to answer "does file X exist" — that is the database service's job.

## Layering

| Dir                                   | Rule                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| root (`App`, `types.ts`, `index.css`) | flat, no subdirs                                                                                 |
| `app/`                                | the shell (`Layout`) — mounts providers, sidebar, outlet, toast container                        |
| `services/`                           | one file per external concern, shared by all features, never split per feature                   |
| `shared/`                             | building blocks with cross-feature consumers (components, contexts, hooks, utils, sidebar shell) |
| `features/<x>/`                       | one slice per mode/page: views, sidebar body, components, hooks, contexts, constants, utils      |

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

The downloader server has its own, separate stream (`GET /events`, opened by `DownloadJobsProvider` through
`downloadServer.ts`) carrying a download's start and end. It is push-only too; the one HTTP fetch beside it,
`GET /jobs`, runs once per connect to give the memoryless stream a starting state (see `DOWNLOADS.md`).

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
| `/:course/:lecture`      | `MainView`        |
| `/:course/:lecture/edit` | `EditSummaryView` |

`kind` (lecture vs recitation) is a query param `?kind=recitation`, propagated everywhere rather than
being a route segment. The static `course`/`downloads`/`search` segments outrank the dynamic
`/:course/:lecture` pattern in v7 ranking, so they never collide.

`/downloads` is reached from a plain nav link in the sidebar header, not a sidebar mode — clicking any
sidebar mode navigates away from it, which is the intended "exit on sidebar click".

## Sidebar modes

`Sidebar` declares `Record<AppMode, { label, Component }>` (insertion order = segment order) and hands it
to `ModeToggle`, which owns the mode as component state persisted in `localStorage` (`fastStudyMode`,
falling back to the default on an unknown key) and renders the selected body. Mode bodies take no props;
each derives its own selection from the route.

## Styling

One flat `index.css` with CSS custom properties — no CSS modules or styled-components. Any user-supplied
text (course, lecture, section, recording titles) renders with `dir="auto"` so Hebrew resolves RTL per
element. Font stack is Noto Sans Hebrew with system fallbacks.
