# CLAUDE.md — backend

Guidance for Claude Code when working inside `backend/`.

## What this is

FastAPI app exposing the lecture-processing pipeline as HTTP endpoints. Endpoints are fire-and-forget: they kick off a step (or the whole pipeline) as a background asyncio task and return `{"status": "started"}` immediately (or `{"status": "busy"}` if the lecture is already running). Progress and per-step outcomes (done / error / rate_limited) live in the runner's in-flight + error state, which the frontend reads via `GET /status`.

## Pipeline stages

1. **strip_audio** — ffmpeg → mono 16 kHz 32 kbps MP3. Minimal size, enough for ASR.
2. **transcribe** — splits audio into 10-min chunks and calls Groq `whisper-large-v3` per chunk (Hebrew). Chunks because Groq enforces 25 MB per request. On a rate-limit interrupt, partial state is persisted as `transcript.partial.txt` + `transcript.partial.meta.json` so the next call resumes.
3. **summarize** — calls the Gemini API (`google-genai`) authenticated via `GEMINI_API_KEY`. The SDK only honors OAuth credentials in Vertex AI mode; the Developer API path used here requires an API key. The transcript (and optional material PDF) are uploaded as file parts; the Hebrew prompt at `assets/instructions/summarize.md` is sent alongside. Edit the prompt file to change output structure — no code change needed.
4. **to_pdf** — pandoc + XeLaTeX render to PDF. Hebrew font (Noto Serif Hebrew) is bundled in `assets/fonts/`. Math expressions (`$...$`, `$$...$$`) render correctly.
5. **upload_to_drive** — uploads the PDF to `{GDRIVE_ROOT_FOLDER}/{course}/[Recitations/]` in Google Drive and writes the share link to `drive_url.txt`.

## Directory layout

```
backend/
  assets/
    fonts/            NotoSansHebrew-*.ttf (body) + MiriamMonoCLM-*.ttf (dual-script mono for code blocks); all bundled, no system install
    instructions/     summarize.md (Hebrew prompt sent to Gemini); overview/{slug}.md (per-extractor Hebrew analysis prompts, filename = extractor slug — edit the file, no code change)
    templates/        pandoc_template.tex (XeLaTeX template for PDF output)
    filters/          ltr_code.lua (pandoc Lua filter wrapping code blocks in \begin{english} for LTR)
  pipeline/           per-LECTURE logic: pure functions, one module per step
    strip_audio.py       strip_audio(video_path, audio_path)
    transcribe.py        transcribe_audio(audio_path) -> str            (raises TranscribeRateLimitError)
    summarize.py         summarize(transcript_path, material_path=None) -> str (raises RuntimeError on Gemini API failure)
    to_pdf.py            convert_to_pdf(md_path) -> str (output path)
    upload_to_drive.py   upload_to_drive(pdf_path, course, file_name=None, subfolder=None) -> str (webViewLink)
  course/             per-COURSE logic (aggregates across a course's lectures — never belongs in pipeline/)
    overview.py          snippet extraction: Extractor registry (EXTRACTORS, keyed by kebab-case `slug` with a display `title`), EXTRACTORS_BY_SLUG, split_sentences, extract_snippets, build_report, analyze(extractor, report, course) (raises RuntimeError on Gemini API failure)
    runner.py            overview execution engine — try_run_generate schedules the sequential extract→analyze driver under ONE per-course lock (held across both phases), run status, the two phase workers (all keyed by extractor slug)
  runner.py           unified per-lecture execution engine — step executors, in-flight tracking & orchestration
  timing/             SQLite-backed per-operation duration log
    __init__.py          init_db, get_stats, _record, @timed_pipeline decorator
    timing.db            persistent store of (operation, file_size_bytes, duration_seconds)
    README.md
  tests/
    conftest.py       adds pipeline/ and backend/ to sys.path so tests can import modules
    test_to_pdf.py
    test_transcribe.py
    test_overview.py
    test_course_runner.py
    test_summarize.py
    test_runner.py
    test_upload_to_drive.py
  services/
    db_client.py      thin HTTP client for the database service (every read/write goes through here)
    google_auth.py    shared OAuth helper — loads credentials.json/token_drive.json, returns Credentials for a given scope set
    llm_client.py     shared Gemini client — LLMClient(model): generate(contents)/upload_file/delete_file, GEMINI_API_KEY auth, SDK errors → RuntimeError (used by summarize.py + course/overview.py)
  main.py             FastAPI app + uvicorn entry point
  credentials.json    Google OAuth client (gitignored)
  token_drive.json    Google OAuth token cache (gitignored)
  pyproject.toml
```

## File naming convention per lecture

Each lecture lives at `{DATA_ROOT}/{course}/{lecture}/` (or `{DATA_ROOT}/{course}/Recitations/{name}/` for recitations) and accumulates these files:

| File                            | Produced by         |
|---------------------------------|---------------------|
| `video.mp4`                     | user / downloader   |
| `audio.mp3`                     | `/run/audio`        |
| `transcript.txt`                | `/run/transcribe`   |
| `transcript.partial.txt`        | `/run/transcribe` (on rate-limit) |
| `transcript.partial.meta.json`  | `/run/transcribe` (on rate-limit) |
| `material.pdf` (optional)       | user                |
| `summary.md`                    | `/run/summarize`    |
| `summary.pdf`                   | `/run/pdf`          |
| `drive_url.txt`                 | `/run/drive`        |

Paths under `DATA_ROOT` are not resolved here — every read/write goes through `services/db_client.py` (HTTP to the `database/` service on port 8001). The `(course, lecture, kind)` tuple is the only identifier the backend carries; `kind="recitation"` is forwarded as a query string so the database service injects the `Recitations/` segment.

## Docs

Folder is at: @docs , and it contains:
- @docs/PDF.md

## API endpoints

Per-step: `POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}` where `step ∈ {audio, transcribe, summarize, pdf, drive}`. `kind` defaults to `lecture`. The route validates that the step's prerequisite file exists, returning `{"status": "error", "message": "<file> is required — run <previous step> first"}` otherwise; on success it fires the step as a background task and returns `{"status": "started"|"busy"}`. Step results (e.g. `usedMaterial` for summarize, the `drive` URL, rate-limit progress) live in the runner's in-flight/error state, not the HTTP response.

Whole-lecture: `POST /courses/{course}/lectures/{lecture}/pipeline?kind=...` advances the lecture through every remaining step in the background; returns `{"status": "started"|"busy"}`.

Course overview is one fire-and-forget trigger that runs BOTH phases (extract then analyze) sequentially in the background under ONE per-course lock, returning `{"status": "started"|"busy"}` (`busy` when the lock is already held), or `{"status": "error", ...}` for an unknown extractor/course. `extractors` is an optional CSV of extractor **slugs** (default: all in `course/overview.py`'s `EXTRACTORS`). The slug (e.g. `exam-hints`) is the single identifier used on the wire, as the status-map key, and as the on-disk file stem — the display `title` (e.g. "Exam Hints") never appears in a filename or CSV. There is no per-phase endpoint; the frontend never sequences phases itself (mirrors `/run-all`).

- `POST /courses/{course}/overview/generate?extractors=exam-hints,pitfalls` — extract phase (scans every lecture's/recitation's `transcript.txt` tree-driven, writes one `{slug}.txt` snippet report per extractor to the course overview area) then analyze phase (per extractor reads its `{slug}.txt`, sends it to Gemini, writes `{slug}-analyzed.md`; a missing `.txt` marks that extractor `skipped` — "no snippets file — run extract first" — and the rest continue). `running` stays `true` and the lock stays held across both phases, so the UI shows one spinner with no false "done" flicker between phases.
- `GET /courses/{course}/overview/status` — `{"running", "phase": "extract"|"analyze"|null, "started_at", "extractors": {slug: {"status": "pending"|"running"|"done"|"skipped"|"error", "message"?}}}` (snake_case on the wire); `phase` is `analyze` once the run reaches it; never-run course → `{"running": false, "phase": null, "started_at": null, "extractors": {}}`.
- `GET /overview/extractors` — static `{"extractors": [{"slug", "title"}]}` listing in `EXTRACTORS` declaration order, for the UI (slug = identifier/file stem, title = label).

Runner: `POST /run-all` kicks off `runner.run_all()` as a background task (or returns `{status: "already_running", ...}` if a run is in progress, or `{status: "empty_queue"}` if nothing is pending). `GET /status` returns a snapshot from `runner.get_status()` — `{runner: {running, total, done, last_error}, in_flight: [...], errors: {...}}`. The runner also fires on a daily APScheduler cron at 03:00 (configured in `main.py`'s `lifespan`).

Timing: `GET /timing/{operation}?file_size_bytes=N` → linear-regression estimate from past runs (or `{"message": "not-enough-data"}`).

## Environment

Reads `.env` (repo root). Required:

- `GROQ_API_KEY` — Groq API key for Whisper transcription
- `GEMINI_API_KEY` — Gemini API key for the summarize step
- `GDRIVE_ROOT_FOLDER` — name of the root Google Drive folder
- `DATABASE_URL` (optional, default `http://localhost:8001`) — the database service base URL

## Running

Dependencies and the Python version (3.12, pinned in `.python-version`) are managed by [uv](https://docs.astral.sh/uv/). `uv run` auto-creates/syncs `backend/.venv` from `pyproject.toml` + `uv.lock` — no manual activation.

```bash
cd backend
uv sync --extra test             # one-time / after dep changes: build the venv
uv run uvicorn main:app --reload # dev (port 8000)
```

`--reload` watches the cwd (`backend/`), and the runner writes `timing/timing.db` there each run — so watchfiles logs a steady stream of "N changes detected" (SQLite touches the `.db` plus its journal). It's only noise (non-`.py`, so no actual restart), but to mute it `npm run dev` sets `UVICORN_RELOAD_EXCLUDE='*.db timing/*'` (uvicorn reads `UVICORN_`-prefixed env vars; it has no config-file support). Set the same env var if you launch uvicorn by hand.

## Running tests

```bash
cd backend
uv run pytest tests/ -q
```

CI runs exactly this on every push (any branch) — see `.github/workflows/ci.yml` (installs uv + pandoc 2.9.2.1, then `uv sync --extra test` + `uv run pytest`).

## Testing after every logic update

Whenever pipeline logic changes (anything under `pipeline/`, or any helper invoked by it), this is non-negotiable:

1. **Run existing tests first** — `uv run pytest tests/ -q`. Green baseline confirms the change didn't break adjacent behavior. If a test fails, fix the code or update the test deliberately — never silently delete or skip it.
2. **Add tests for the new logic** in the matching `tests/test_<module>.py`. Cover: the regression case (a test that fails without the fix), the happy path, and at least one edge case (empty input, escape/special chars, boundary between protected and unprotected regions). See `TestNormalizeMathSpans` and `TestForceLtrInlineCode` in `tests/test_to_pdf.py` for the shape.
3. **Re-run the full suite** after adding tests. The change isn't done until `uv run pytest tests/ -q` is green.

This applies even to "small" or "obvious" changes — preprocessing helpers in `to_pdf.py` look trivial but interact with bidi/LaTeX in surprising ways, which is exactly why every helper there has a dedicated test class.

## Key design decisions

- **All filesystem access goes through the database service.** `services/db_client.py` is responsible to call database API - get/put/exists/delete file, get/put summary. Endpoints download inputs to a `tempfile.TemporaryDirectory`, run the pipeline, and upload outputs back — keeping `pipeline/*` untouched as pure path-taking functions.
- Pipeline functions are pure: they take file paths / strings, no global state.
- Asset paths (`fonts/`, `summarize.md`, `pandoc_template.tex`) are resolved relative to `__file__` inside each pipeline module — they point to `backend/assets/`.
- CORS is open to `http://localhost:5173` only.
- Pipeline steps run as fire-and-forget asyncio tasks; endpoints return immediately (`started`/`busy`) and the frontend polls `GET /status`. A per-lecture `asyncio.Lock` serializes concurrent triggers for the same lecture.
- `summarize.py` raises `RuntimeError` on Gemini API failure (not `sys.exit`) so the endpoint can catch and return `{"status": "error"}`. Auth uses `GEMINI_API_KEY` from the environment — the `google-genai` SDK silently ignores OAuth `credentials=` outside of Vertex AI mode.
- `transcribe.py` raises `TranscribeRateLimitError` carrying `{limit, used, requested, retry_after_seconds, completed_chunks, total_chunks}` and writes partial state to disk; the next `/run/transcribe` call picks up from `transcript.partial.txt`. The transcribe endpoint round-trips the partial via the database service AND restores `audio.mp3`'s mtime from `transcript.partial.meta.json` — re-downloading audio.mp3 gives it a fresh mtime which would otherwise invalidate the resume meta and force a full restart.
- `timing/` records every pipeline operation's `(file_size, duration)` so the frontend can show calibrated ETAs.
- `runner.py` walks the tree looking for lectures that have `video.mp4` but lack `drive_url.txt` (`scan_pending`) and runs them sequentially through every missing step via `run_all(queue)`. It fires a `database/notify` SSE ping on each meaningful state change (step start/done, rate-limit start/wake, error, run start/complete) so the frontend can react without polling. On `rate_limited`, it sleeps `RATE_LIMIT_SLEEP_SECONDS` (3600s — Groq's hourly ASR window) and retries the same step.
- All in-flight state is tracked uniformly in `_in_flight` (skey → entry) regardless of trigger source — the runner, `/pipeline`, and individual `/run/{step}` calls all populate the same map. The frontend reads from `inFlight[]` and doesn't care which path queued the entry.
- **`pipeline/` is per-LECTURE logic; `course/` is per-COURSE logic.** Anything that aggregates across a course's lectures (the course overview feature) lives under `course/`, never `pipeline/`. `course/runner.py` mirrors the backend-root per-lecture `runner.py`: overview doesn't fit the `(course, lecture, kind)`-keyed `_in_flight` map, so its state is a per-course status dict + lock there, keeping `main.py` thin route glue.
- The course overview feature aggregates every transcript in a course and writes to `{DATA_ROOT}/{course}/overview/` via the database service's overview endpoints (`db_client.put_overview_file` / `get_overview_file`). Whisper transcripts are near-unbroken blobs, so `course/overview.py` windows by sentence, never by line; one extractor's failure is recorded and the rest continue. `db_client.notify()` fires after EACH extractor finishes (done/skipped/error) in both phases, once at the extract→analyze phase boundary, and once at run end, so the frontend refreshes per ping.
- **Extractor identity is the `slug`, not the display name.** Each `Extractor` carries a kebab-case `slug` (the on-disk file stem, the status-map key, and the `?extractors=` CSV value) plus a human `title` used only in the UI and the report header. Its Gemini prompt lives at `assets/instructions/overview/{slug}.md` (a `prompt_file` property derives the name). Historically the display name doubled as the file stem, which desynced on-disk `exam-hints.txt` from the frontend's lookup of `Exam Hints.txt` — the slug split fixes that; keep filenames slug-based across backend, database, and frontend.
- `summarize.py` accepts an optional `material_pdf` path — when the lecture dir contains `material.pdf`, the endpoint downloads it into the workspace and passes it to Gemini alongside the transcript.
