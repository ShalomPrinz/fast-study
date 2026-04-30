# CLAUDE.md — frontend

## What this is

React + Vite + TypeScript app that provides a UI for the lecture-processing pipeline. It talks to two servers:
- **Vite dev server** (localhost:5173) — serves the app and handles `/api/tree` filesystem reads
- **FastAPI backend** (localhost:8000) — runs the pipeline steps

## Running

```bash
cd frontend
npm run dev      # dev server on localhost:5173
npm run build    # production build → dist/
```

## Environment

`.env` (not committed) must define:

| Variable | Purpose |
|---|---|
| `VITE_DATA_ROOT` | Absolute path to the data directory (read server-side by the Vite plugin) |
| `VITE_API_URL` | Backend base URL, default `http://localhost:8000` |

## Directory layout

```
frontend/
  src/
    api.ts               — fetchTree(), runStep(); all backend/tree calls go here
    App.tsx              — top-level state: courses, selected lecture, request state
    index.css            — all styles (single flat file, CSS variables for theming)
    main.tsx             — React entry point
    vite-env.d.ts        — /// <reference types="vite/client" /> for import.meta.env
    components/
      Sidebar.tsx        — collapsible course tree, lecture selection, action buttons
      MainView.tsx       — spinner / Done ✓ / error display
  vite.config.ts         — includes fsPlugin: serves GET /api/tree from VITE_DATA_ROOT
  tsconfig.json          — single config covering src/ and vite.config.ts
  index.html             — loads Inter + Noto Sans Hebrew from Google Fonts
```

## Key design decisions

- **Filesystem access** — the browser can't read the local filesystem. A custom Vite plugin (`fsPlugin` in `vite.config.ts`) reads `VITE_DATA_ROOT` with Node's `fs` at dev-server startup and exposes the result as the virtual module `virtual:tree`. The app imports it directly (`import { tree } from 'virtual:tree'`) — no HTTP call involved. The tree is static for the lifetime of the dev server; restart Vite to pick up new courses/lectures.
- **No routing library** — selected lecture is plain React state in `App.tsx`.
- **Single CSS file** — all styles in `index.css` with CSS custom properties. No CSS modules or styled-components.
- **Hebrew rendering** — folder name labels use `dir="auto"` so the browser auto-detects RTL. Font stack includes Noto Sans Hebrew (loaded from Google Fonts) with system-font fallbacks that support Hebrew (Segoe UI, Arial).
- **tsconfig** — one `tsconfig.json` covers both `src/` and `vite.config.ts`. Node types needed by the Vite plugin come from a `/// <reference types="node" />` directive at the top of `vite.config.ts`, avoiding the need for a separate `tsconfig.node.json`.

## State shape (App.tsx)

```ts
courses:   Course[]                          // loaded once on mount from /api/tree
selected:  { course: string; lecture: string } | null
reqState:  { step: Step; status: 'inflight' | 'done' | 'error'; message?: string } | null
```

Selecting a new lecture resets `reqState`. Starting a run sets `status: 'inflight'`; all action buttons are disabled while inflight.

## API (src/api.ts)

Only contains backend pipeline calls — filesystem access is not here.

| Function | Description |
|---|---|
| `runStep(course, lecture, step)` | POST `{VITE_API_URL}/courses/{course}/lectures/{lecture}/run/{step}` |

Course and lecture names are `encodeURIComponent`-encoded in URLs (handles Hebrew folder names).

## Filesystem (virtual:tree)

`import { tree } from 'virtual:tree'` gives a `Course[]` read directly from `VITE_DATA_ROOT` by the Vite plugin at startup. Declared in `src/vite-env.d.ts`. No HTTP, no async — just a module import.
