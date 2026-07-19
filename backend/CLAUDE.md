# CLAUDE.md — backend

Guidance for Claude Code when working inside `backend/`.

## What this is

FastAPI app exposing two things over HTTP: the per-lecture video → audio → transcript → summary → PDF → Drive pipeline, and the per-course overview generator. Every mutating endpoint is fire-and-forget — it schedules a background asyncio task and returns `started`/`busy`; the frontend polls the status endpoints.

## Docs

`docs/` holds the durable architecture and hard-won knowledge. Read the relevant one before changing that area, and update it in the same pass when a change makes it stale.

- @docs/PIPELINE.md — per-lecture stages, execution/lock model, rate-limit handling, timing
- @docs/OVERVIEW.md — course overview: extractors, phases, run/lock model, `from_phase` + `skip_existing`
- @docs/API.md — endpoint reference
- @docs/PDF.md — pandoc/XeLaTeX bidi gotchas and the markdown preprocessing chain
- `timing/README.md` — timing.db schema, queries, maintenance scripts

## Layout

```
backend/
  main.py             FastAPI app + uvicorn entry point; thin route glue only
  pipeline/           per-LECTURE logic — one pure module per step + runner.py (execution engine)
  course/             per-COURSE logic — overview.py (registry), runner.py, and one module per phase
  services/           db_client.py (all filesystem I/O), llm_client.py (Gemini), google_auth.py (OAuth)
  timing/             SQLite per-operation duration log + @timed_pipeline decorator
  assets/
    fonts/            NotoSansHebrew-* (body) + MiriamMonoCLM-* (dual-script mono); bundled, no system install
    instructions/     summarize.md, overview/{slug}.md — Hebrew prompts; edit the file, no code change
    templates/        pandoc_template.tex
    filters/          ltr_code.lua
  tests/              subdirs mirror the source packages (course/, pipeline/, services/); no __init__.py
  credentials.json    Google OAuth client (gitignored)
  token_drive.json    Google OAuth token cache (gitignored)
```

## Lecture files

Each lecture lives at `{DATA_ROOT}/{course}/{lecture}/`, recitations at `{DATA_ROOT}/{course}/Recitations/{name}/`. Paths are never resolved here — every read/write goes through `services/db_client.py` (HTTP to `database/` on port 8001), and `(course, lecture, kind)` is the only identifier the backend carries. File names and their producing steps are listed in `docs/PIPELINE.md`.

## Key rules

- **Pipeline functions stay pure** — paths/strings in, no global state, no `DATA_ROOT` knowledge. Endpoints download inputs into a tempdir workspace, run the function, upload outputs back.
- **`pipeline/` is per-lecture, `course/` is per-course.** Anything aggregating across a course's lectures belongs in `course/`, never `pipeline/`.
- **Keep `main.py` thin** — validation and boundary parsing live in the runners.
- Asset paths resolve relative to `__file__`.

## Environment

Reads the repo-root `.env`. Required: `GROQ_API_KEY`, `GEMINI_API_KEY`, `GDRIVE_ROOT_FOLDER`. Optional: `DATABASE_URL` (default `http://localhost:8001`).

## Running

Dependencies and Python 3.12 are managed by [uv](https://docs.astral.sh/uv/); `uv run` auto-syncs `backend/.venv`.

```bash
cd backend
uv sync --extra test             # one-time / after dep changes
uv run uvicorn main:app --reload # dev (port 8000)
```

## Testing after every logic update

```bash
uv run pytest tests/ -q          # CI runs exactly this on every push
```

Whenever logic under `pipeline/`, `course/`, or `services/` changes, this is non-negotiable:

1. **Run the suite first** for a green baseline. If a test fails, fix the code or update the test deliberately — never silently delete or skip it.
2. **Add tests for the new logic** in the matching `tests/{pipeline,course,services}/test_<module>.py`. Cover the regression case (fails without the fix), the happy path, and one edge case (empty input, escaping, a protected/unprotected boundary).
3. **Re-run the full suite.** The change isn't done until it's green.

This applies to "small" changes too — the `to_pdf.py` preprocessing helpers look trivial and interact with bidi/LaTeX in surprising ways, which is why every one of them has a test class.

## Documentation and comment style

- Docs and comments describe the **current state** and the durable WHY — never plans, phased build steps, or "how we got here" history. Plans live in plan files; when a plan ships, fold what's durable into `docs/` and drop the narrative.
- Comments explain what a function does and the idea behind it. Adding them everywhere is noise — skip anything that restates the code.
- Docstrings are one line, two at most, followed by one blank line before the body.
- Architecture belongs in `docs/`; inline comments stay to short, specific technical details (two lines max).
