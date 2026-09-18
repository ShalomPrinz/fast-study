# CLAUDE.md — backend

## What this is

FastAPI app exposing two things over HTTP: the per-lecture video → audio → transcript → summary → PDF → Drive pipeline, and the per-course overview generator. Every mutating endpoint is fire-and-forget — it schedules a background asyncio task and returns `started`/`busy`; the frontend reads outcomes from the status endpoints, refetching on the database service's SSE notify.

## Docs

Read the relevant doc before changing that area, and update it in the same pass when a change makes it stale.

| Doc                                    | Covers                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| [docs/PIPELINE.md](docs/PIPELINE.md)   | per-lecture stages and files, the run/lock/queue model, `AUTO_RUN`, nightly pass, rate limits |
| [docs/OVERVIEW.md](docs/OVERVIEW.md)   | course overview: extractors, phases, run/lock model, `from_phase` + `skip_existing`        |
| [docs/API.md](docs/API.md)             | endpoint reference                                                                         |
| [docs/PDF.md](docs/PDF.md)             | the pandoc → tectonic render, outcome rules, warning markers, failure messages            |
| [docs/BIDI.md](docs/BIDI.md)           | Hebrew RTL: engine limits, the Lua filter, the markdown preprocessing chain, verifying a fix |
| [timing/README.md](timing/README.md)   | timing.db schema, queries, maintenance scripts                                             |

## Layout

Fonts in `assets/fonts/` are bundled — never assume a system install; the render copies them into its build dir rather than pointing at them ([docs/PDF.md](docs/PDF.md)). Hebrew prompts live in `assets/instructions/` (`summarize.md`, `overview/{slug}.md`); edit the file, no code change.

## Lecture files

Each lecture lives at `{DATA_ROOT}/{course}/{lecture}/`, recitations at `{DATA_ROOT}/{course}/Recitations/{name}/`. Paths are never resolved here — every read/write goes through `services/db_client.py` (HTTP to `database/` on port 8001), and `(course, lecture, kind)` is the only identifier the backend carries. File names and their producing steps are in [docs/PIPELINE.md](docs/PIPELINE.md).

## Key rules

- **Pipeline functions stay pure** — paths/strings in, no global state, no `DATA_ROOT` knowledge. Endpoints download inputs into a tempdir workspace, run the function, upload outputs back.
- **`pipeline/` is per-lecture, `course/` is per-course.** Anything aggregating across a course's lectures belongs in `course/`, never `pipeline/`.
- **Keep `backend_main.py` thin** — validation and boundary parsing live in the runners.
- Shipped read-only files (`assets/`, `credentials.json`) resolve through `resource_path()` in `services/resources.py`, never off `__file__`.
- **A new top-level module needs a name `database/` could never want too.** Both services freeze into one PyInstaller bundle whose module graph is flat, so `backend_main`, `course`, `pipeline`, `services` and `timing` are global names — prefix a generic one or nest it under an existing package (root `CLAUDE.md`). Code that never freezes (`timing/scripts/`, `tests/`) is exempt.
- **`database/` never calls back.** The backend calls it, so a return call would make the service graph cyclic and the packaged build unspawnable (root `CLAUDE.md`). When a backend feature wants the store to notify or trigger it, invert it: the acting client reports in, or the backend subscribes to the database's SSE channel.

## Environment

Reads the repo-root `.env`. Required: `GROQ_API_KEY`, `GEMINI_API_KEY`, plus `GDRIVE_ROOT_FOLDER` once Drive is on. Optional: `DATABASE_URL` (default `http://localhost:8001`), plus `GEMINI_MODEL`, `DRIVE_ENABLED`, `AUTO_RUN`, `NIGHTLY_RUN` and `NIGHTLY_HOUR` (defaults in `services/settings.py`).

**Never read a setting at import.** `POST /config` rewrites `os.environ` on the running process, so every consumer reads its variable at call time — `services/settings.py` for the model and the Drive toggle, `llm_client`/`transcribe`/`upload_to_drive` for the keys and the Drive folder.

Google Drive consent is a settings action, never a pipeline one — no run ever blocks on a human ([docs/PIPELINE.md](docs/PIPELINE.md), [docs/API.md](docs/API.md)).

`services/providers.py` is the API-key provider table behind `/config/probe-key` and `/config/options`: adding a provider is one row. Each row owns the provider's base URL, which the probe and both SDK clients read — so no ambient variable redirects a call ([docs/PIPELINE.md](docs/PIPELINE.md)) — and it never leaves the backend.

## Running

```bash
cd backend
uv sync --extra test                     # one-time / after dep changes
uv run uvicorn backend_main:app --reload # dev (port 8000)
uv run python backend_main.py            # packaged: binds FASTSTUDY_PORT (0 = ephemeral), no reload
uv run pytest tests/ -q                  # CI runs exactly this on every push
```

This environment is also what the frozen bundle is built from, for both Python services, so `pyproject.toml` here has to carry every runtime dependency `database/` declares as well (root `CLAUDE.md`).

`import runtime` and `import tools` are [lib/runtime](../lib/runtime/CLAUDE.md) and [lib/tools](../lib/tools/CLAUDE.md), which own their rules. Backend-specific use:

- `FASTSTUDY_SECRET` enforces the launch secret on inbound requests, and `db_client` forwards it to `database/` ([docs/API.md](docs/API.md)).
- `runtime.serve` binds the socket and prints the port handshake; `backend_main.py` is the packaged entry.
- `ffmpeg`, `pandoc` and `tectonic` are spawned through `tool_path(name)`, never by bare name. `backend_main.py` probes them once at startup and reports the result on `/health`; a missing one fails only the steps that need it. A dev machine needs all three to run the pipeline end to end.
- `runtime.state_path` locates everything written outside `DATA_ROOT` — `timing.db` and the Google token — and each caller mkdirs its own parent.

## Testing

New tests go in the matching `tests/{pipeline,course,services}/test_<module>.py`. Never silently delete or skip a failing test — fix the code or update the test deliberately.

This applies to "small" changes too: the `pipeline/pdf/` preprocessing helpers look trivial and interact with bidi/LaTeX in surprising ways, which is why every one of them has a test class under `tests/pipeline/pdf/`.

## Comment style

Root `CLAUDE.md` covers the general rules. Backend-specific: docstrings are one line, two at most, followed by one blank line before the body.
