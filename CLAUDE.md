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

## Packaged launch contract

Every service carries its own module named `runtime` (`runtime.py` / `runtime.js` / `runtime.ts`, one per package — never shared across a `node_modules` boundary) implementing the same names verbatim. They are independent files that merely agree on a contract; write a new one from scratch rather than copying a sibling's.

| Thing                    | Name                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| Listen port, in env      | `FASTSTUDY_PORT` — `0` asks for ephemeral, unset keeps the per-service default    |
| Port report, on stdout   | `FASTSTUDY_PORT=<n>` alone on a line, matched `^FASTSTUDY_PORT=(\d+)$`            |
| Launch secret, in env    | `FASTSTUDY_SECRET` — unset means no enforcement, which is dev                     |
| Secret header            | `X-FastStudy-Secret`                                                             |
| Secret query param       | `secret`, for `EventSource`, which cannot set a header                           |
| Writable state root, env | `FASTSTUDY_STATE_DIR` — unset falls back to `.state/` at the repo root            |
| State join               | `statePath(...parts)` / `state_path(*parts)` — a pure join that creates nothing   |
| Preload bridge           | `window.faststudy`                                                               |
| Packaged frontend origin | `app://bundle` — exactly, no trailing slash                                      |

A service that spells any of these differently cannot be launched or called by its peers, so treat a change to a name or a rule as a cross-service change and surface it rather than editing one service's `runtime` alone. Per-service specifics (which routes, which files) live in each service's `CLAUDE.md` and `docs/`.

`app://bundle` is frozen as a literal, never computed. A page at `app://bundle/index.html` sends `Origin: app://bundle` with no trailing slash on every CORS-mode request including the preflight, but Electron's *permission-handler* API reports the same origin **with** one — deriving the allowlist from that API silently rejects every request. Verified on Electron 44.1.1 / Chromium 152.

The state root separates read-only installed resources from per-user writable state, and only the services that write outside `DATA_ROOT` have a state join (`backend/`, both `downloader/` services). Dev deliberately uses the same layout with no fallback to the old scattered locations, so a layout bug surfaces on a dev machine rather than only in an installer build. The packaged `%LOCALAPPDATA%\FastStudy` default is intentionally in no service — the Electron launcher passes `FASTSTUDY_STATE_DIR` explicitly.

## Service subagents

Each service has a dedicated dev subagent (in `.claude/agents/`) that owns all work within that service's directory — code, bug fixes, features, refactors, tests, config, and keeping that service's README/CLAUDE.md current. Route any work touching a service through its subagent.

## Always use `python3`

`python` is not aliased on this WSL setup — always invoke `python3` explicitly.

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
- **Never write documentation inside a data string** — a LaTeX/SQL/shell/template literal the program feeds to a tool is production content, not a place to explain yourself. The rationale goes in the service's `docs/`; if the string itself needs a pointer, put a one-line source comment above the assignment, in the host language.

## Architecture Preferences

- Prefer push-based (SSE/WebSocket/event emitter) designs over polling for progress and status updates. Do not propose polling as the default; if polling seems necessary, state explicitly why push is not viable.
- Implement the simplest version of this that fully satisfies the requirement. No caching layers, no factory splits, no abstraction with a single caller. After implementing, list the complexity you deliberately left out and what signal would justify adding each one later.

## Workflow

- For non-trivial changes: ground yourself in the actual code first, present 2-3 options with tradeoffs, and wait for a decision before implementing. Don't start editing on an ambiguous request.
- When a workaround fails twice, stop implementing and research the root cause — official docs, the API surface, community threads — instead of trying a third variant.
- User owns every version-control write. Never run `add`/`commit`/`stash`/`checkout`.
- Verify empirically — start the service, curl it, kill it, quote the exact output — rather than asserting it works.

## Linting

Every service is linted, and new code must land lint-clean — `npm run lint` from the repo root runs both linters over everything.

Both stay at pyflakes/recommended level — undefined names and unused symbols, no style enforcement — so they run in about a second. Reach for an inline `eslint-disable` / `noqa` only with a reason on the same line; if a rule is wrong repo-wide, change the config instead.

Style is separate and automatic: `ruff format` + import sort for Python, prettier for JS/TS/CSS (`.prettierrc` keeps `frontend/` semicolon-free and `downloader/` semicolon'd, matching what each already was). Never hand-format — `.claude/format.sh` rewrites changed files at the end of every turn.

`.claude/lint.sh` runs both linters on changed files at the end of every turn and every subagent, and `.claude/typecheck.sh` typechecks `frontend/` the same way. A green hook means the code parses and typechecks — never that it works.
