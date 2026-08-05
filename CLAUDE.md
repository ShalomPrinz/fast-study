# CLAUDE.md

Top-level guidance for Claude Code in this repo. Service-specific docs live next to each service.

## What this project is

A four-service app that turns a Hebrew video lecture into a structured written summary (and uploads it to Google Drive). The video → audio → transcript → summary → PDF → Drive pipeline lives in `backend/`; a web UI for driving it lives in `frontend/`; a Chrome extension + helper server for grabbing source videos (and PDFs) off lecture sites lives in `downloader/`; and all filesystem reads/writes under `DATA_ROOT` (plus the cross-service SSE notify channel) are owned by `database/`.

## Repository layout

```
backend/      FastAPI app + pipeline modules (Python).        See backend/CLAUDE.md
frontend/     React + Vite + TS UI (talks to database/).      See frontend/CLAUDE.md
downloader/   Chrome MV3 extension + small Node server.       See downloader/CLAUDE.md
database/     FastAPI service owning all DATA_ROOT I/O + SSE. See database/CLAUDE.md
.env          Shared env file — DATA_ROOT, GROQ_API_KEY, GEMINI_API_KEY, GDRIVE_ROOT_FOLDER
```

All services read the same `.env` at the repo root and share one on-disk layout under `DATA_ROOT`:

```
{DATA_ROOT}/{course}/{lecture}/...                  # lectures
{DATA_ROOT}/{course}/Recitations/{name}/...         # recitations
```

`database/` is the single source of truth for this layout. When changing paths, file names, or course/recitation conventions, update it there — the other services hold no path conventions and reach disk only by calling the database service.

Beyond that, `downloader/` also calls `backend/` to record download durations into `timing.db`, so the frontend can show a calibrated ETA for a download the same way it does for a pipeline step.

## Service subagents

Each service has a dedicated dev subagent (in `.claude/agents/`) that owns all work within that service's directory — code, bug fixes, features, refactors, tests, config, and keeping that service's README/CLAUDE.md current. Route any work touching a service through its subagent.

## Always use `python3`

`python` is not aliased on this WSL setup — always invoke `python3` explicitly.

## Always ask user for clarifications

For every architecture decision, small or big, ask the user to clarify his intention.
When you catch yourself reading a phrase like "if possible I'd like X" or "what do you recommend" as approval to implement X — it isn't. Answer the question, then wait.
I prefer being sure of what's going to happen before you actually do it, so no redundant work is ever done by you.

## Documentation and code style

- A comment describes what a function does and the idea behind it — plus the non-obvious WHY when there is one: a hidden constraint, a subtle invariant, a workaround for a specific bug. Skip comments that just restate the code.
- Commenting everything is noise. Comment what a reader would otherwise get wrong, and leave the rest bare.
- Keep it short: one line is the default, two is the maximum. Never write multi-paragraph docstrings or multi-line comment blocks to fill space. Architecture belongs in the service's `docs/`.
- Docs and comments describe the _current_ state and the durable WHY — not implementation plans, phased build steps, or "how we got here" history. Plans belong in plan files; once a plan ships, fold its durable knowledge into docs and drop the narrative.

## Architecture Preferences

- Prefer push-based (SSE/WebSocket/event emitter) designs over polling for progress and status updates. Do not propose polling as the default; if polling seems necessary, state explicitly why push is not viable.
- Implement the simplest version of this that fully satisfies the requirement. No caching layers, no factory splits, no abstraction with a single caller. After implementing, list the complexity you deliberately left out and what signal would justify adding each one later.

## Workflow

- For non-trivial changes: ground yourself in the actual code first, present 2-3 options with tradeoffs, and wait for a decision before implementing. Don't start editing on an ambiguous request.
- When a workaround fails twice, stop implementing and research the root cause — official docs, the API surface, community threads — instead of trying a third variant.

## Linting

Every service is linted, and new code must land lint-clean — `npm run lint` from the repo root runs both linters over everything.

Both stay at pyflakes/recommended level — undefined names and unused symbols, no style enforcement — so they run in about a second. Reach for an inline `eslint-disable` / `noqa` only with a reason on the same line; if a rule is wrong repo-wide, change the config instead.

Style is separate and automatic: `ruff format` + import sort for Python, prettier for JS/TS/CSS (`.prettierrc` keeps `frontend/` semicolon-free and `downloader/` semicolon'd, matching what each already was). Never hand-format — `.claude/format.sh` rewrites changed files at the end of every turn.

`.claude/lint.sh` runs both linters on changed files at the end of every turn and every subagent, and `.claude/typecheck.sh` typechecks `frontend/` the same way. A green hook means the code parses and typechecks — never that it works.
