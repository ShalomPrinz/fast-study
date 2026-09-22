# CLAUDE.md

Top-level guidance for Claude Code in this repo. Service-specific docs live next to each service.

## What this project is

A four-service app that turns a Hebrew video lecture into a structured written summary (and uploads it to Google Drive). The video → audio → transcript → summary → PDF → Drive pipeline lives in `backend/`; a web UI for driving it lives in `frontend/`; a Chrome extension + helper server for grabbing source videos (and PDFs) off lecture sites lives in `downloader/`; and all filesystem reads/writes under `DATA_ROOT` (plus the cross-service SSE notify channel) are owned by `database/`.

## Shared data layout

All services read the same `.env` at the repo root and share one on-disk layout under `DATA_ROOT`:

```
{DATA_ROOT}/{course}/{lecture}/...                  # lectures
{DATA_ROOT}/{course}/Recitations/{name}/...         # recitations
```

`database/` is the single source of truth for this layout. When changing paths, file names, or course/recitation conventions, update it there — the other services hold no path conventions and reach disk only by calling the database service.

Beyond that, `downloader/` also calls `backend/` to record download durations into `timing.db`, so the frontend can show a calibrated ETA for a download the same way it does for a pipeline step.

## Service call graph

The graph must stay acyclic: `frontend/` and `downloader/` call `backend/` and `database/`, `backend/` calls `database/`, and `database/` calls nobody. The packaged build binds every service to `127.0.0.1:0` and spawns them in order `database → backend → auto → server`, handing each peer's port to the next as a plain env var — a cycle would have no valid spawn order and would force a post-boot port exchange.

So never add an outbound call from `database/` to a peer, and treat a proposal to add one as a packaging blocker, not a style preference. If `database/` needs to tell a peer something, either the peer calls in or the fact rides the existing SSE `/events` channel peers already subscribe to.

The rule is about _outbound HTTP calls_, so `lib/` is outside it entirely: services depend on a shared module at build time, never over the wire, and a build-time dependency can no more create a cycle than an import can.

## Packaged launch contract

Every service carries its own module named `runtime` (`runtime.py` / `runtime.js` / `runtime.ts`, one per package — never shared across a `node_modules` boundary) implementing the same names verbatim. They are independent files that merely agree on a contract; write a new one from scratch rather than copying a sibling's.

| Thing                    | Name                                                                            |
| ------------------------ | ------------------------------------------------------------------------------- |
| Listen port, in env      | `FASTSTUDY_PORT` — `0` asks for ephemeral, unset keeps the per-service default  |
| Port report, on stdout   | `FASTSTUDY_PORT=<n>` alone on a line, matched `^FASTSTUDY_PORT=(\d+)$`          |
| Launch secret, in env    | `FASTSTUDY_SECRET` — unset means no enforcement, which is dev                   |
| Secret header            | `X-FastStudy-Secret`                                                            |
| Secret query param       | `secret`, for `EventSource`, which cannot set a header                          |
| Writable state root, env | `FASTSTUDY_STATE_DIR` — unset falls back to `.state/` at the repo root          |
| State join               | `statePath(...parts)` / `state_path(*parts)` — a pure join that creates nothing |
| Bundled binary dir, env  | `FASTSTUDY_BIN_DIR` — unset means resolve off PATH, which is dev                |
| Binary join              | `toolPath(name)` / `tool_path(name)` — adds `.exe` on Windows only              |
| Preload bridge           | `window.faststudy`                                                              |
| Packaged frontend origin | `app://bundle` — exactly, no trailing slash                                     |

A service that spells any of these differently cannot be launched or called by its peers, so treat a change to a name or a rule as a cross-service change and surface it rather than editing one service's `runtime` alone. Per-service specifics (which routes, which files) live in each service's `CLAUDE.md` and `docs/`.

`app://bundle` is frozen as a literal, never computed — why is in [`electron/docs/RENDERER.md`](electron/docs/RENDERER.md).

The state root separates read-only installed resources from per-user writable state, and only the services that write outside `DATA_ROOT` have a state join (`backend/`, both `downloader/` services). Dev deliberately uses the same layout with no fallback to the old scattered locations, so a layout bug surfaces on a dev machine rather than only in an installer build. The packaged `%LOCALAPPDATA%\FastStudy` default is intentionally in no service — the Electron launcher passes `FASTSTUDY_STATE_DIR` explicitly.

`FASTSTUDY_BIN_DIR` is the same shape one level down: set, every external tool (`ffmpeg`, `pandoc`, `tectonic`, `yt-dlp`) is spawned by absolute path out of it, with the `yt-dlp` and `curl` exceptions explained in [`lib/tools/CLAUDE.md`](lib/tools/CLAUDE.md). Each service probes its own tools at startup and reports them on `/health`; a missing binary disables one feature, never the service. Every binary here ships in the installer, so before adding one, check whether a short in-process parse would do and say what the binary costs in installer size.

## The frozen Python bundle — `delivery/`

`backend/` and `database/` ship as **one** PyInstaller one-dir bundle, `services`, with the service
picked by `argv[1]`. `delivery/services.spec` is the build and `delivery/entry.py` is its entry
point; both are build-only inputs that no dev command touches.

```
cd backend && uv run --with pyinstaller pyinstaller ../delivery/services.spec
```

The build runs out of `backend/`'s environment, which works only because **`database/`'s
dependencies are a strict subset of `backend/`'s**. That is an invariant nothing checks: a
dependency added to `database/` alone would be absent from the bundle and fail at runtime on a
clean machine, so it has to be added to `backend/pyproject.toml` too.

PyInstaller's module graph is flat, so no top-level module name may appear in both services. That is
why the entry points are `backend_main.py` and `database_main.py` rather than two `main.py`, and it
is a live constraint on every new top-level module: `backend/` owns `course`, `pipeline`,
`services`, `timing`; `database/` owns `events`, `fs`, `settings`. The generic names on the
`database/` side are the ones a future dependency could collide with — `fs` is a real PyPI package.

Freezing moves `__file__` inside the bundle, so **every read-only file that ships with the code
resolves through `resource_path()`** (`backend/services/resources.py`), never a `__file__` walk —
`assets/` and `credentials.json`. Binaries are not among them: they resolve through `lib/tools/` off
`FASTSTUDY_BIN_DIR`, which freezing does not affect.

## The launcher — `electron/`

The desktop shell that turns the four services into one app: it generates the launch secret, spawns
`database → backend → auto → server` on ephemeral ports, waits for each `/health`, and opens a
window on the built frontend served over `app://bundle`. It also owns the settings store the
children's environment comes from — JSON under `%APPDATA%`, the two API keys through `safeStorage`,
decrypted into each child's environment at spawn — and killing every child on quit.

It holds no product logic and never touches `DATA_ROOT`. Read [`electron/CLAUDE.md`](electron/CLAUDE.md)
before changing anything there; the names it spells are the launch contract above, so a change to
one of them is a cross-service change.

## Shared modules — `lib/`

`lib/<name>/` holds the modules more than one service needs, each subfolder a self-contained package
that splits its halves into a `py/` and a `js/` package with the shared `CLAUDE.md` at the parent:
`lib/runtime/` (the launch contract — port handshake, launch-secret check, state root; Python + JS),
`lib/tools/` (external-binary resolution and the boot-time version probe; Python + JS) and
`lib/logging/` (`setup_logging()`; Python only, so its `js/` slot stays empty — the Node services use
plain `console`). Consumers declare a real dependency (editable path deps for Python, `file:` deps
for the downloader packages), so every service resolves one copy.

A module earns a place there when a second service needs it _and_ divergence between copies would be
a defect; a helper with one consumer stays in its service. Read [`lib/CLAUDE.md`](lib/CLAUDE.md) and
the per-module ones before changing anything there — an edit under `lib/` is live in four services at once.

## Error codes

Every failure a service reports carries a stable machine `code` and a flat `params` object beside its
English prose, and the frontend renders the sentence from its own Lingui catalogs. The services author
no user-facing wording; their prose is the developer-facing description and the fallback an unknown
code renders. Third-party text — ffmpeg, Gemini, yt-dlp, the OS — is never translated: it rides as a
`detail` param and renders verbatim beneath a translated headline.

The whole vocabulary, per channel and per service, is in [`docs/ERROR-CODES.md`](docs/ERROR-CODES.md),
with the excluded set and the reason each row is excluded. Adding a failure means adding a row there
and a catalog entry in `frontend/`; adding one without the catalog entry is supported — it falls back
to the English prose — but is not finished. `frontend/src/shared/i18n/errorCodeDrift.test.ts` holds
the three in step: it greps the services for emitted codes and fails when one is undocumented, or
when the doc calls a code user-reachable and no catalog row says it.

## Service subagents

Each service has a dedicated dev subagent (in `.claude/agents/`) that owns all work within that service's directory — code, bug fixes, features, refactors, tests, config, and keeping that service's README/CLAUDE.md current. Route any work touching a service through its subagent.

`lib-dev` owns `lib/`, `electron-dev` owns `electron/` and `delivery-dev` owns `delivery/` plus `.github/workflows/{build,publish}.yml`, all under the same one difference: none edits a consumer. `lib/`'s packages are live in all four services at once, the launcher spells the same launch contract from the other side, and `delivery/` builds and smoke-tests a tree whose every name a service or the launcher owns — so each reports the follow-up a service needs and that follow-up goes to that service's subagent.

## Running Python

Anything that imports a service's code runs through `uv` from that service's directory — `cd database && uv run pytest tests/ -q`. Bare `python3` is the system 3.10 with none of the service's dependencies, so it dies at the first import.

Everything else — a throwaway one-liner, a standalone script that imports no service code — is plain `python3`; `python` is not aliased on this WSL setup.

## Reading `DATA_ROOT`

The repo-root `.env` is permission-denied — it holds the Groq/Gemini keys, so it is blocked wholesale. Read the resolved value from `curl -s localhost:8001/settings` instead; the database service reports both keys as set/unset and never returns them.

## Always ask user for clarifications

For every architecture decision, small or big, ask the user to clarify his intention.
When you catch yourself reading a phrase like "if possible I'd like X" or "what do you recommend" as approval to implement X — it isn't. Answer the question, then wait.
I prefer being sure of what's going to happen before you actually do it, so no redundant work is ever done by you.

## Documentation and code style

- A comment describes what a function does and the idea behind it — plus the non-obvious WHY when there is one: a hidden constraint, a subtle invariant, a workaround for a specific bug. Skip comments that just restate the code.
- Commenting everything is noise. Comment what a reader would otherwise get wrong, and leave the rest bare.
- Keep it short: one line is the default, two is the maximum. Never write multi-paragraph docstrings or multi-line comment blocks to fill space. Architecture belongs in the service's `docs/`.
- Docs, comments, and every `CLAUDE.md` describe the _current_ state and the durable WHY — never implementation plans, phase/step numbers, plan references, or "was TODO / now done". When behavior changes, edit the affected line to read as if it always worked that way. History lives in git; once a plan ships, fold its durable knowledge into docs and drop the narrative.
- **A doc link in a `CLAUDE.md` never carries an `@` prefix.** `@path` is an import: the file is inlined into context on every session that loads that `CLAUDE.md`, whether or not the task goes near it. Point at `docs/` with plain relative links so the docs stay lazy and `CLAUDE.md` stays the index — a doc table of four `@` links silently costs several hundred lines on every unrelated edit.
- **Never write documentation inside a data string** — a LaTeX/SQL/shell/template literal the program feeds to a tool is production content, not a place to explain yourself. The rationale goes in the service's `docs/`; if the string itself needs a pointer, put a one-line source comment above the assignment, in the host language.

## Architecture Preferences

- Prefer push-based (SSE/WebSocket/event emitter) designs over polling for progress and status updates. Do not propose polling as the default; if polling seems necessary, state explicitly why push is not viable.
- Implement the simplest version of this that fully satisfies the requirement. No caching layers, no factory splits, no abstraction with a single caller. After implementing, list the complexity you deliberately left out and what signal would justify adding each one later. That list is for _optional additions_ only — user-visible behavior your own change broke is a regression, not a trade-off, and it gets fixed in the same pass rather than listed.

## Workflow

- For non-trivial changes: ground yourself in the actual code first, present 2-3 options with tradeoffs, and wait for a decision before implementing. Don't start editing on an ambiguous request.
- When a workaround fails twice, stop implementing and research the root cause — official docs, the API surface, community threads — instead of trying a third variant.
- Before surfacing an incidental finding — git history, branch state, earlier attempts, side effects — ask whether the user would decide or act differently knowing it. If yes, say it in one line with what it changes; if not, drop it, from replies and prompt files alike.
- User owns every version-control write. Never run `add`/`commit`/`stash`/`checkout`.
- Verify empirically — start the service, curl it, kill it, quote the exact output — rather than asserting it works.

## Linting

Every service is linted, and new code must land lint-clean — `npm run lint` from the repo root runs both linters over everything.

Both stay at pyflakes/recommended level — undefined names and unused symbols, no style enforcement — so they run in about a second. Reach for an inline `eslint-disable` / `noqa` only with a reason on the same line; if a rule is wrong repo-wide, change the config instead.

Style is separate and automatic: `ruff format` + import sort for Python, prettier for JS/TS/CSS (`.prettierrc` keeps `frontend/` semicolon-free and `downloader/` semicolon'd, matching what each already was). Never hand-format — `.claude/hooks/format.sh` rewrites changed files at the end of every turn.

`.claude/hooks/lint.sh` runs both linters on changed files at the end of every turn and every subagent, and `.claude/hooks/typecheck.sh` typechecks `frontend/` the same way. A green hook means the code parses and typechecks — never that it works. How the three hooks work is in [`.claude/hooks/README.md`](.claude/hooks/README.md).
