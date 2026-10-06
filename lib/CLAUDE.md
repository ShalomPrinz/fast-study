# lib/

Modules that more than one service needs. Each subfolder is a self-contained package whose Python
half is in `py/` and JS half in `js/`, sharing one `CLAUDE.md` at the package root.

| Package                         | What it is                                                                        | Consumers                                              |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`runtime/`](runtime/CLAUDE.md) | The packaged launch contract: port handshake, launch-secret check, CORS allowlist, state root. | py: `backend/`, `database/` · js: both `downloader/`   |
| [`tools/`](tools/CLAUDE.md)     | External-binary resolution (`FASTSTUDY_BIN_DIR`) and the boot-time version probe. | py: `backend/` · js: both `downloader/`                |
| [`logging/`](logging/CLAUDE.md) | `setup_logging()` — the stderr `[api] POST /path → 200` access log. Python only.  | `backend/`, `database/`                                |
| [`sentry/`](sentry/CLAUDE.md)   | Sentry policy, no SDK: the reports on/off transport gate, the scrubber, tags, init options.            | py: `backend/`, `database/` · js: both `downloader/`, `electron/`, `frontend/` |

## Admission rule

A module belongs here when **a second service needs it** _and_ **divergence between copies would be
a defect** — both, not one. A helper with a single consumer stays in its service, and so does one
where two services legitimately want different behavior.

All four qualify because they are contracts, two of them boundaries: a service whose secret check or
`/health` exemption drifts from its peers' is unreachable by the launcher or quietly less protected,
one whose scrubber drifts leaks course names or keys to Sentry, and one that reads
`FASTSTUDY_BIN_DIR` differently cannot spawn its own tools.
Duplicating a helper is cheap; duplicating a contract is not.

## Rules across packages

- **A behavioral claim in a `lib/` doc holds on both run paths** — packaged (`runtime.serve()` under
  the launcher) and dev (`uv run uvicorn --reload`, plain `node`). Where they differ, state the
  invariant covering both and keep the difference: it is usually why the wiring exists.
- **Outside the call graph.** `lib/` calls nothing and is depended on at build time, never over
  HTTP, so it cannot create a cycle and needs no port, secret or spawn slot.
- **Consumers declare a path dep** — an editable `[tool.uv.sources]` path dep on `../lib/<name>/py`,
  or `file:…/lib/<name>/js`. Python consumers, `electron/` and `frontend/` get a link, so an edit is
  live there. Both `downloader/` packages install with `npm ci --install-links` (as CI and
  `delivery/stage.mjs` require, so the staged tree has real files), which copies `@faststudy/*`: a
  `js/` edit reaches them only after rerunning that in each. `readlink -f
  downloader/*/node_modules/@faststudy/<pkg>` shows which you have.

## Adding a `js/` package

- It joins the root `workspaces: ["lib/*/js"]`: run `npm install` at the repo root so the root
  `package-lock.json` lists it — CI's root `npm ci` fails on an out-of-sync lock.
- Add its `py/` and `js/` suites to `.github/workflows/test.yml`, which lists each `lib/` suite by hand.

## Testing

Each package's suite is in its `CLAUDE.md`. Because a change lands in four services at once, also
run the consumers: `cd backend && uv run pytest tests/ -q`, `cd database && uv run pytest tests/ -q`,
and for the two test-less `downloader/` packages an import smoke-check of `@faststudy/runtime`.
