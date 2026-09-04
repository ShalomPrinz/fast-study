# CLAUDE.md — database

## What this is

FastAPI service that owns every read, write, and listing under `DATA_ROOT`, plus the
cross-service SSE notify channel. The frontend, downloader, and backend all get filesystem state
from here — no other service touches disk. One exception to "under `DATA_ROOT`": it also owns the
settings store, which is the repo-root `.env`.

It is the single source of truth for the on-disk path layout and for the HTTP contract the other
services depend on. Treat changes to endpoints, response shapes, or the layout as contract
changes: keep them backward-compatible or flag the impact.

## Docs

| Doc                                  | Covers                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [docs/LAYOUT.md](docs/LAYOUT.md)     | `DATA_ROOT` layout, path resolution, dotfiles, tree shape                    |
| [docs/API.md](docs/API.md)           | route table, response envelope, write semantics, access logging, trust model |
| [docs/SETTINGS.md](docs/SETTINGS.md) | the settings store: fields, `.env` merge, `DATA_ROOT` validation             |
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | the course-level `overview/` area and `meta.json` atomicity                  |
| [docs/EVENTS.md](docs/EVENTS.md)     | SSE channel and clean shutdown                                               |

## Layout

`fs/paths.py` is the single source of truth for path resolution and layout constants, and holds the data root as module state written only by `set_data_root()`. `tests/` uses a conftest that points that state at a per-test tmp dir.

## Environment

Reads the repo-root `.env` via `python-dotenv`:

- `DATA_ROOT` — absolute path to the data directory. Absent or blank still boots: the root stays unset and every filesystem endpoint answers `409` until `POST /config` sets one.
  `GET /health` is liveness only and answers `200` regardless, so the launcher can tell healthy-but-unconfigured from dead.

It holds no peer URLs, because it makes **no outbound HTTP calls** — it only answers requests and
fans out SSE. Every peer address it would need belongs to a service that already calls it, so
staying call-free keeps the service graph acyclic. That is a packaging constraint, not a
preference: the packaged build binds every service to `127.0.0.1:0` and spawns them
`database → backend → auto → server`, passing each peer's port on as a plain env var, so a
`database → backend` call has no valid spawn order. When a peer needs to hear about something
here, it either calls in or reads the SSE `/events` channel — announcing a stored video, for
instance, is done by the uploader (downloader server, frontend), not by the store.

`settings.py` also _writes_ that `.env`: it is the store behind the app's settings surface in
browser dev (`GET`/`PUT /settings`), and `POST /config` sets the running process's data root with
no restart. The write is a merge — only settings keys are rewritten, and the API keys are
write-only. See [docs/SETTINGS.md](docs/SETTINGS.md).

## Running and testing

```bash
cd database
uvicorn main:app --reload --port 8001   # dev
python3 -m pytest tests/ -q
```

Port `8001` (backend 8000, frontend 5173, downloader 3052). `npm run dev` at the repo root brings
all four up together.

`python3 main.py` is the packaged entry point instead, never the dev one: `runtime.serve` binds
`127.0.0.1:$FASTSTUDY_PORT` (`0` asks for an ephemeral port, unset means `8001`) and prints
`FASTSTUDY_PORT=<n>` on stdout, because uvicorn never reports what `port=0` resolved to and the
launcher has to read the real port back. Loopback only, no reload.

`runtime.install_secret_check` then requires `$FASTSTUDY_SECRET` on every request but `GET /health`
— as the `X-FastStudy-Secret` header or a `secret` query parameter, since `EventSource` cannot set a
header. Unset (dev) installs nothing. It is pure ASGI and sits inside CORS on purpose; see
[docs/API.md](docs/API.md).

Both come from the shared [`lib/runtime`](../lib/runtime/CLAUDE.md), imported as plain
`import runtime` — the launch contract is a wire contract with the other services, so a second copy
that drifted would leave this service unreachable by the launcher or less protected than its peers.
`import runtime` also calls `load_dotenv()`, which is why it must stay above any module that reads
the environment at import time.

## Documentation rules

Root `CLAUDE.md` covers the general rules. Database-specific:

- Every `def` / `async def` gets a one-line docstring stating intent, not mechanics. Full reasoning belongs in `docs/`.
- Update the affected doc and docstring in the same pass as the code change.
