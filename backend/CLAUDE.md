# CLAUDE.md — backend

Guidance for Claude Code when working inside `backend/`.

## What this is

FastAPI app exposing the lecture-processing pipeline as HTTP endpoints. Each endpoint runs synchronously (no background tasks, no job polling) and returns `{"status": "done"}` / `{"status": "error", "message": ...}`. The transcribe endpoint additionally returns `{"status": "rate_limited", ...}` when Groq throttles mid-run.

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
    fonts/            NotoSansHebrew-Regular.ttf (bundled, no system install needed)
    instructions/     summarize.md (Hebrew prompt sent to Gemini)
    templates/        pandoc_template.tex (XeLaTeX template for PDF output)
  pipeline/           pure functions, one module per step
    strip_audio.py       strip_audio(video_path, audio_path)
    transcribe.py        transcribe_audio(audio_path) -> str            (raises TranscribeRateLimitError)
    summarize.py         summarize(transcript_path, material_pdf=None) -> str (raises RuntimeError on Gemini API failure)
    to_pdf.py            convert_to_pdf(md_path) -> str (output path)
    upload_to_drive.py   upload_to_drive(pdf_path, course, file_name=None, subfolder=None) -> str (webViewLink)
  resume.py           background runner that finishes lectures whose pipelines stopped mid-way
  timing/             SQLite-backed per-operation duration log
    __init__.py          init_db, get_stats, _record, @timed_pipeline decorator
    timing.db            persistent store of (operation, file_size_bytes, duration_seconds)
    README.md
  tests/
    conftest.py       adds pipeline/ and backend/ to sys.path so tests can import modules
    test_to_pdf.py
    test_transcribe.py
    test_summarize.py
    test_resume.py
  services/
    db_client.py      thin HTTP client for the database service (every read/write goes through here)
    google_auth.py    shared OAuth helper — loads credentials.json/token_drive.json, returns Credentials for a given scope set
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

## API endpoints

All pipeline endpoints: `POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}` where `step ∈ {audio, transcribe, summarize, pdf, drive}`. `kind` defaults to `lecture`.

Each endpoint validates that its prerequisite file exists and returns `{"status": "error", "message": "<file> is required — run <previous step> first"}` otherwise. `/run/summarize` additionally returns `usedMaterial: true` when an optional `material.pdf` was found in the lecture dir and passed to Gemini alongside the transcript.

Resume runner: `POST /resume-all` kicks off `resume.resume_all()` as a background task (or returns `{status: "already_running", ...}` if a run is in progress). `GET /resume-status` returns a snapshot of the live status dict (`running`, `total`, `done`, `current`, `sleeping_until`, `last_error`). The runner also fires on a daily APScheduler cron at 03:00 (configured in `main.py`'s `lifespan`).

Timing: `GET /timing/{operation}?file_size_bytes=N` → linear-regression estimate from past runs (or `{"message": "not-enough-data"}`).

## Environment

Reads `.env` (repo root). Required:

- `GROQ_API_KEY` — Groq API key for Whisper transcription
- `GEMINI_API_KEY` — Gemini API key for the summarize step
- `GDRIVE_ROOT_FOLDER` — name of the root Google Drive folder
- `DATABASE_URL` (optional, default `http://localhost:8001`) — the database service base URL

## Running

```bash
cd backend
uvicorn main:app --reload        # dev (port 8000)
python3 main.py                  # also works, same port
```

## Running tests

```bash
cd backend
python3 -m pytest tests/ -q
```

## Testing after every logic update

Whenever pipeline logic changes (anything under `pipeline/`, or any helper invoked by it), this is non-negotiable:

1. **Run existing tests first** — `python3 -m pytest tests/ -q`. Green baseline confirms the change didn't break adjacent behavior. If a test fails, fix the code or update the test deliberately — never silently delete or skip it.
2. **Add tests for the new logic** in the matching `tests/test_<module>.py`. Cover: the regression case (a test that fails without the fix), the happy path, and at least one edge case (empty input, escape/special chars, boundary between protected and unprotected regions). See `TestNormalizeMathSpans` and `TestForceLtrInlineCode` in `tests/test_to_pdf.py` for the shape.
3. **Re-run the full suite** after adding tests. The change isn't done until `pytest tests/ -q` is green.

This applies even to "small" or "obvious" changes — preprocessing helpers in `to_pdf.py` look trivial but interact with bidi/LaTeX in surprising ways, which is exactly why every helper there has a dedicated test class.

## Key design decisions

- **All filesystem access goes through the database service.** `services/db_client.py` is responsible to call database API - get/put/exists/delete file, get/put summary. Endpoints download inputs to a `tempfile.TemporaryDirectory`, run the pipeline, and upload outputs back — keeping `pipeline/*` untouched as pure path-taking functions.
- Pipeline functions are pure: they take file paths / strings, no global state.
- Asset paths (`fonts/`, `summarize.md`, `pandoc_template.tex`) are resolved relative to `__file__` inside each pipeline module — they point to `backend/assets/`.
- CORS is open to `http://localhost:5173` only.
- No background tasks, no job polling — every endpoint blocks until done.
- `summarize.py` raises `RuntimeError` on Gemini API failure (not `sys.exit`) so the endpoint can catch and return `{"status": "error"}`. Auth uses `GEMINI_API_KEY` from the environment — the `google-genai` SDK silently ignores OAuth `credentials=` outside of Vertex AI mode.
- `transcribe.py` raises `TranscribeRateLimitError` carrying `{limit, used, requested, retry_after_seconds, completed_chunks, total_chunks}` and writes partial state to disk; the next `/run/transcribe` call picks up from `transcript.partial.txt`. The transcribe endpoint round-trips the partial via the database service AND restores `audio.mp3`'s mtime from `transcript.partial.meta.json` — re-downloading audio.mp3 gives it a fresh mtime which would otherwise invalidate the resume meta and force a full restart.
- `timing/` records every pipeline operation's `(file_size, duration)` so the frontend can show calibrated ETAs.
- `resume.py` walks the tree looking for lectures that have `video.mp4` but lack `drive_url.txt` and runs them sequentially through every missing step. It fires a `database/notify` SSE ping on each meaningful state change (step start/done, rate-limit start/wake, error, run start/complete) so the frontend can react without polling. On `rate_limited`, it sleeps `RATE_LIMIT_SLEEP_SECONDS` (3600s — Groq's hourly ASR window) and retries the same step.
- `_status` in `resume.py` has two independent in-flight fields: `current` (owned exclusively by the resume runner) and `single_auto_current` (owned exclusively by `db_workspace_tracked` via `set_current`/`clear_current`). Neither path touches the other's field, so there's no clobber race. One edge case remains: if a video upload triggers `run_audio?notify=true` on the same lecture the resume runner is simultaneously processing, both fields are set at once. The frontend resolves this by preferring `current` (resume runner), so the auto step's progress bar is silently suppressed for the duration — acceptable since the runner will advance the step anyway.
- `summarize.py` accepts an optional `material_pdf` path — when the lecture dir contains `material.pdf`, the endpoint downloads it into the workspace and passes it to Gemini alongside the transcript.
