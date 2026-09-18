# lib/

Modules that more than one service needs. Each subfolder is a self-contained package whose Python
half is in `py/` and JS half in `js/`, sharing one `CLAUDE.md` at the package root.

| Package                         | What it is                                                                        | Consumers                                              |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`runtime/`](runtime/CLAUDE.md) | The packaged launch contract: port handshake, launch-secret check, state root.    | py: `backend/`, `database/` · js: both `downloader/`   |
| [`tools/`](tools/CLAUDE.md)     | External-binary resolution (`FASTSTUDY_BIN_DIR`) and the boot-time version probe. | py: `backend/` · js: both `downloader/`                |
| [`logging/`](logging/CLAUDE.md) | `setup_logging()` — the stderr `[api] POST /path → 200` access log. Python only.  | `backend/`, `database/`                                |

## Admission rule

A module belongs here when **a second service needs it** _and_ **divergence between copies would be
a defect** — both, not one. A helper with a single consumer stays in its service, and so does one
where two services legitimately want different behavior.

All three qualify because they are contracts, one of them a security boundary: a service whose
secret check or `/health` exemption drifts from its peers' is unreachable by the launcher or quietly
less protected, and one that reads `FASTSTUDY_BIN_DIR` differently cannot spawn its own tools.
Duplicating a helper is cheap; duplicating a contract is not.

## Rules across packages

- **A behavioral claim in a `lib/` doc holds on both run paths** — packaged (`runtime.serve()` under
  the launcher) and dev (`uv run uvicorn --reload`, plain `node`). Where they differ, state the
  invariant covering both and keep the difference: it is usually why the wiring exists.
- **Outside the call graph.** `lib/` calls nothing and is depended on at build time, never over
  HTTP, so it cannot create a cycle and needs no port, secret or spawn slot.
- **Consumers link, not copy** — an editable `[tool.uv.sources]` path dep on `../lib/<name>/py`, or
  `file:../../lib/<name>/js` — so an edit here is live in every consumer with no reinstall.

## Testing

Each package's suite is in its `CLAUDE.md`. Because a change lands in four services at once, also
run the consumers: `cd backend && uv run pytest tests/ -q`, `cd database && uv run pytest tests/ -q`,
and for the two test-less `downloader/` packages an import smoke-check of `@faststudy/runtime`.
