# lib/

Modules that more than one service needs, each in its own subfolder as a self-contained package
holding its JS and Python halves flat side by side.

| Folder                                  | What it is                                                          |
| --------------------------------------- | ------------------------------------------------------------------- |
| [`runtime/`](runtime/CLAUDE.md)          | The packaged launch contract: port handshake, launch-secret check, state root. Python + JS. |
| [`logging/`](logging/CLAUDE.md)          | `setup_logging()` — the `[api] POST /path → 200` access log. Python only. |

## Why these live here and not in the services

Both are wire contracts between processes, and one of them is a security boundary. Two copies that
drift apart are a bug by definition, not a variation: a service whose `/health` exemption or secret
comparison differs from its peers' is either unreachable by the launcher or quietly less protected
than the rest. Duplication of a helper is cheap; duplication of a contract is not.

## Admission rule

A module belongs here when **a second service needs it** *and* **divergence between copies would be
a defect**. Both halves, not one. A helper with a single consumer stays in its service, and so does
one where two services legitimately want different behavior — put it here only when they must agree.

## Relation to the service call graph

`lib/` calls nothing and is called by everything, so it sits outside the acyclic call graph in the
root `CLAUDE.md` entirely. Consumers depend on it at build time — an editable path dependency for
Python, a `file:` dependency for Node — never over HTTP, so it can never introduce a cycle and never
needs a port, a secret or a spawn slot of its own.

## Consuming it

Python (`backend/`, `database/`), in `pyproject.toml`:

```toml
dependencies = ["faststudy-runtime", "faststudy-logging"]

[tool.uv.sources]
faststudy-runtime = { path = "../lib/runtime", editable = true }
faststudy-logging = { path = "../lib/logging", editable = true }
```

Node (`downloader/server`, `downloader/auto`), in `package.json`:

```json
"@faststudy/runtime": "file:../../lib/runtime"
```

Both are editable/symlinked, so an edit under `lib/` is live in every consumer with no reinstall —
which is also the hazard: a change here lands in four services at once. Run each consumer's tests,
not just this folder's.
