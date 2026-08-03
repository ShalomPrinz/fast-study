# CLAUDE.md — database

## What this is

FastAPI service that owns every read, write, and listing under `DATA_ROOT`, plus the
cross-service SSE notify channel. The frontend, downloader, and backend all get filesystem state
from here — no other service touches disk.

It is the single source of truth for the on-disk path layout and for the HTTP contract the other
services depend on. Treat changes to endpoints, response shapes, or the layout as contract
changes: keep them backward-compatible or flag the impact.

## Docs

| Doc                            | Covers                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| [docs/LAYOUT.md](docs/LAYOUT.md)     | `DATA_ROOT` layout, path resolution, dotfiles, tree shape   |
| [docs/API.md](docs/API.md)           | route table, response envelope, write semantics, trust model |
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | the course-level `overview/` area and `meta.json` atomicity |
| [docs/EVENTS.md](docs/EVENTS.md)     | SSE channel and clean shutdown                              |

## Directory layout

```
database/
  main.py        FastAPI app, routes, uvicorn entry
  fs/
    paths.py       path resolution + layout constants — the single source of truth
    tree.py        read_tree / read_course
    summary.py     read/write/revert summary.md
    summaries.py   every non-empty summary.md in a course (client-side search corpus)
    files.py       resolve a lecture file path
    crud.py        create/rename/archive course, create/rename lecture, video + file writes
    overview.py    course-level overview files and meta.json
  events/sse.py  in-memory pub/sub: subscribe() + broadcast_notify()
  tests/         pytest; conftest points DATA_ROOT at a per-test tmp dir
```

## Environment

Reads the repo-root `.env` via `python-dotenv`:

- `DATA_ROOT` (required) — absolute path to the data directory.
- `BACKEND_URL` (default `http://localhost:8000`) — target of the post-video-upload audio trigger.

## Running and testing

```bash
cd database
uvicorn main:app --reload --port 8001   # or: python3 main.py
python3 -m pytest tests/ -q
```

Port `8001` (backend 8000, frontend 5173, downloader 3052). `npm run dev` at the repo root brings
all four up together.

## Documentation rules

- Every `def` / `async def` gets a one-line docstring stating intent, not mechanics. Add a second
  line only when the WHY is genuinely non-obvious; full reasoning belongs in `docs/`.
- Inline comments are one-liners for small technical details. Architecture and rationale go in
  `docs/`.
- **Docs and comments describe the current state and the durable WHY — never plans, phased steps,
  or "how we got here" history.** Plans live in plan files; once shipped, fold the durable part
  into `docs/` and drop the narrative.
- Update the affected doc and docstring in the same pass as the code change.
