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

## Layout

`fs/paths.py` is the single source of truth for path resolution and layout constants. `tests/` uses a conftest that points `DATA_ROOT` at a per-test tmp dir.

## Environment

Reads the repo-root `.env` via `python-dotenv`:

- `DATA_ROOT` (required) — absolute path to the data directory.
- `BACKEND_URL` (default `http://localhost:8000`) — target of the post-video-upload pipeline trigger.

## Running and testing

```bash
cd database
uvicorn main:app --reload --port 8001   # or: python3 main.py
python3 -m pytest tests/ -q
```

Port `8001` (backend 8000, frontend 5173, downloader 3052). `npm run dev` at the repo root brings
all four up together.

## Documentation rules

Root `CLAUDE.md` covers the general rules. Database-specific:

- Every `def` / `async def` gets a one-line docstring stating intent, not mechanics. Full reasoning belongs in `docs/`.
- Update the affected doc and docstring in the same pass as the code change.
