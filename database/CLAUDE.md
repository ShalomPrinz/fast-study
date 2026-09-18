# CLAUDE.md — database

FastAPI service that owns every read, write and listing under `DATA_ROOT`, plus the cross-service
SSE notify channel. No other service touches disk. The one file it writes outside `DATA_ROOT` is the
repo-root `.env` behind the settings store.

It is the single source of truth for the on-disk layout and for the HTTP contract the other services
depend on: treat a change to an endpoint, a response shape or the layout as a contract change — keep
it backward-compatible or flag the impact.

## Docs

| Doc                                  | Covers                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| [docs/LAYOUT.md](docs/LAYOUT.md)     | `DATA_ROOT` layout, name sanitizing, materials, dotfiles, tree shape   |
| [docs/API.md](docs/API.md)           | route table, response envelope, write semantics, file locks, trust model |
| [docs/SETTINGS.md](docs/SETTINGS.md) | the settings store: fields, `.env` merge, `DATA_ROOT` validation, unset root |
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | the course-level `overview/` area and `meta.json` atomicity            |
| [docs/EVENTS.md](docs/EVENTS.md)     | the SSE notify channel and clean shutdown                              |

## Rules

- **`fs/paths.py` owns path resolution.** `lecture_dir(course, lecture, kind)` is the only resolver,
  and the data root is module state written only by `set_data_root()`. It also owns the two guards
  every caller shares: `check_safe_segment()` and `reject_if_locked()` (a Windows sharing violation →
  `FileLocked` → `423`).
- **No outbound HTTP calls, ever** — it only answers requests and fans out SSE, so it holds no peer
  URLs. Why that is a packaging blocker is in the root [`CLAUDE.md`](../CLAUDE.md); a peer that needs
  to hear about something here calls in or subscribes to `/events`.
- **Frozen with `backend/` into one PyInstaller bundle** (root `CLAUDE.md`). This side owns the
  top-level names `database_main`, `events`, `fs` and `settings` — any new one must not collide with
  backend's or a dependency's (`fs` is a real PyPI package). A new runtime dependency must also go
  into `backend/pyproject.toml`, or the bundle lacks it; test-only extras are exempt.
- `database_main.DEFAULT_PORT` is the single `8001` default, read by the dev `__main__` path and by
  `delivery/entry.py`.

## Environment

`DATA_ROOT` comes from the repo-root `.env`, loaded by `import runtime` — which is why that import
precedes the module-level root seeding in `database_main.py` ([`lib/runtime`](../lib/runtime/CLAUDE.md)).
Absent or blank still boots: filesystem routes answer `409` until `POST /config` sets a root, and
`GET /health` answers `200` regardless. See [docs/SETTINGS.md](docs/SETTINGS.md).

## Running and testing

```bash
cd database
uv run uvicorn database_main:app --reload --port 8001   # dev
uv run pytest tests/ -q
```

`npm run dev` at the repo root brings all four services up together (backend 8000, frontend 5173,
downloader 3052).

`uv run python database_main.py` is the packaged entry point, never the dev one: `runtime.serve`
does the launcher's port handshake, and `runtime.install_secret_check` enforces `FASTSTUDY_SECRET`,
installed before `CORSMiddleware` so a `401` carries CORS headers. Both are the shared
[`lib/runtime`](../lib/runtime/CLAUDE.md); the access log is [`lib/logging`](../lib/logging/CLAUDE.md).

Tests call the app through `TestClient` or the `fs/` helpers directly; an autouse fixture in
`tests/conftest.py` points `fs.paths._data_root` at a per-test tmp dir, so no test touches real data.

## Documentation rules

Root `CLAUDE.md` covers the general rules. Database-specific:

- Every `def` / `async def` gets a one-line docstring stating intent, not mechanics. Full reasoning belongs in `docs/`.
- Update the affected doc and docstring in the same pass as the code change.
