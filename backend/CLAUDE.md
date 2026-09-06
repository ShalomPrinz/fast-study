# CLAUDE.md — backend

Guidance for Claude Code when working inside `backend/`.

## What this is

FastAPI app exposing two things over HTTP: the per-lecture video → audio → transcript → summary → PDF → Drive pipeline, and the per-course overview generator. Every mutating endpoint is fire-and-forget — it schedules a background asyncio task and returns `started`/`busy`; the frontend reads outcomes from the status endpoints, refetching on the database service's SSE notify.

## Docs

`docs/` holds the durable architecture and hard-won knowledge. Read the relevant one before changing that area, and update it in the same pass when a change makes it stale.

- @docs/PIPELINE.md — per-lecture stages, execution/lock model, rate-limit handling, timing
- @docs/OVERVIEW.md — course overview: extractors, phases, run/lock model, `from_phase` + `skip_existing`
- @docs/API.md — endpoint reference
- @docs/PDF.md — the pandoc → tectonic render, the outcome rules and warning recovery, bidi gotchas, the markdown preprocessing chain
- `timing/README.md` — timing.db schema, queries, maintenance scripts

## Layout

Fonts in `assets/fonts/` are bundled — never assume a system install; the render copies them into its build dir rather than pointing at them (`docs/PDF.md`). Hebrew prompts live in `assets/instructions/` (`summarize.md`, `overview/{slug}.md`); edit the file, no code change. `tests/` subdirs mirror the source packages.

## Lecture files

Each lecture lives at `{DATA_ROOT}/{course}/{lecture}/`, recitations at `{DATA_ROOT}/{course}/Recitations/{name}/`. Paths are never resolved here — every read/write goes through `services/db_client.py` (HTTP to `database/` on port 8001), and `(course, lecture, kind)` is the only identifier the backend carries. File names and their producing steps are listed in `docs/PIPELINE.md`.

## Key rules

- **Pipeline functions stay pure** — paths/strings in, no global state, no `DATA_ROOT` knowledge. Endpoints download inputs into a tempdir workspace, run the function, upload outputs back.
- **`pipeline/` is per-lecture, `course/` is per-course.** Anything aggregating across a course's lectures belongs in `course/`, never `pipeline/`.
- **Keep `main.py` thin** — validation and boundary parsing live in the runners.
- Asset paths resolve relative to `__file__`.
- **`database/` never calls back.** The backend calls it, so a return call would make the service graph cyclic and the packaged build unspawnable (see root `CLAUDE.md`). When a backend feature wants the store to notify or trigger it, invert it: the acting client reports in, or the backend subscribes to the database's SSE channel.

## Environment

Reads the repo-root `.env`. Required: `GROQ_API_KEY`, `GEMINI_API_KEY`, plus `GDRIVE_ROOT_FOLDER` once Drive is on. Optional: `DATABASE_URL` (default `http://localhost:8001`), `GEMINI_MODEL` and `DRIVE_ENABLED` (defaults in `services/settings.py`).

**Never read a setting at import.** `POST /config` rewrites `os.environ` on the running process, so every consumer reads its variable at call time — `services/settings.py` for the model and the Drive toggle, `llm_client`/`transcribe`/`upload_to_drive` for the keys and the Drive folder.

`services/providers.py` is the API-key provider table behind `/config/probe-key` and `/config/options`: adding a provider is one row, and its probe URL never leaves the backend.

## Running

```bash
cd backend
uv sync --extra test             # one-time / after dep changes
uv run uvicorn main:app --reload # dev (port 8000)
uv run python main.py            # packaged: binds FASTSTUDY_PORT (0 = ephemeral), no reload
uv run pytest tests/ -q          # CI runs exactly this on every push
```

`FASTSTUDY_SECRET` (launch-time, set by the packaged launcher) makes the secret check installed by `runtime.install_secret_check` reject every unauthenticated inbound request and makes `db_client` send the secret on its calls to `database/`; unset means no enforcement, which is what dev runs on. Rules and header names: `docs/API.md`.

`runtime` is the shared launch module from `lib/runtime`, installed as a top-level `import runtime`. `runtime.serve` binds the loopback socket itself so it can print `FASTSTUDY_PORT=<port>` on stdout for the launcher to parse — `uvicorn.run(port=0)` never reports what it bound.

External tools — `ffmpeg`, `ffprobe`, `pandoc`, `tectonic` — are spawned through `tool_path(name)` from `lib/tools` (installed as a top-level `import tools`), never by bare name: `FASTSTUDY_BIN_DIR` set means an absolute path into the shipped binaries, unset means PATH, which is dev. `main.py` probes all four once at startup, logs each missing one, and reports the result on `/health` as `tools` — a missing binary fails only the steps that need it, so it never stops the service starting. All four must be installed for a dev machine to run the pipeline end to end.

`runtime.state_path(*parts)` resolves everything the backend writes outside `DATA_ROOT` — `timing.db` and the per-scope Google token — under one root: `FASTSTUDY_STATE_DIR` if set, else `.state/` at the repo root. It is a pure join and creates nothing, so each caller mkdirs its own parent — otherwise an import would leave a directory behind, including in tests that redirect the path.

## Testing

New tests go in the matching `tests/{pipeline,course,services}/test_<module>.py`. Never silently delete or skip a failing test — fix the code or update the test deliberately.

This applies to "small" changes too — the `pipeline/pdf/` preprocessing helpers look trivial and interact with bidi/LaTeX in surprising ways, which is why every one of them has a test class under `tests/pipeline/pdf/`.

## Documentation and comment style

Root `CLAUDE.md` covers the general rules. Backend-specific: docstrings are one line, two at most, followed by one blank line before the body. Architecture belongs in `docs/`.

Docs and comments describe the **current state** and the durable WHY — never plans, phase/step numbers, or "was TODO / now done". When behavior changes, edit the affected line to read as if it always worked that way.
