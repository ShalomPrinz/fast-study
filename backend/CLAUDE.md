# CLAUDE.md — backend

Guidance for Claude Code when working inside `backend/`.

## What this is

FastAPI app exposing the lecture-processing pipeline as HTTP endpoints. Each endpoint runs synchronously (no background tasks, no job polling) and returns `{"status": "done"}` / `{"status": "error", "message": ...}`. The transcribe endpoint additionally returns `{"status": "rate_limited", ...}` when Groq throttles mid-run.

## Pipeline stages

1. **strip_audio** — ffmpeg → mono 16 kHz 32 kbps MP3. Minimal size, enough for ASR.
2. **transcribe** — splits audio into 10-min chunks and calls Groq `whisper-large-v3` per chunk (Hebrew). Chunks because Groq enforces 25 MB per request. On a rate-limit interrupt, partial state is persisted as `transcript.partial.txt` + `transcript.partial.meta.json` so the next call resumes.
3. **summarize** — pipes the transcript into Gemini CLI using the Hebrew prompt at `assets/instructions/summarize.md`. Edit that file to change output structure — no code change needed.
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
    transcribe.py        transcribe_audio(audio_path, api_key) -> str  (raises TranscribeRateLimitError)
    summarize.py         summarize(transcript_path) -> str             (raises RuntimeError on Gemini failure)
    to_pdf.py            convert_to_pdf(md_path) -> str (output path)
    upload_to_drive.py   upload_to_drive(pdf_path, course, root_folder_name, filename, subfolder=None) -> str (webViewLink)
  timing/             SQLite-backed per-operation duration log
    __init__.py          init_db, get_stats, _record, @timed_pipeline decorator
    timing.db            persistent store of (operation, file_size_bytes, duration_seconds)
  tests/
    conftest.py       adds pipeline/ and backend/ to sys.path so tests can import modules
    test_to_pdf.py
    test_transcribe.py
    test_db_client.py
  services/
    db_client.py      thin HTTP client for the database service (every read/write goes through here)
  main.py             FastAPI app + uvicorn entry point
  credentials.json    Google OAuth client (gitignored)
  token.json          Google OAuth token cache (gitignored)
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
| `summary.md`                    | `/run/summarize`    |
| `summary.pdf`                   | `/run/pdf`          |
| `drive_url.txt`                 | `/run/drive`        |

Paths under `DATA_ROOT` are not resolved here — every read/write goes through `services/db_client.py` (HTTP to the `database/` service on port 8001). The `(course, lecture, kind)` tuple is the only identifier the backend carries; `kind="recitation"` is forwarded as a query string so the database service injects the `Recitations/` segment.

## API endpoints

All pipeline endpoints: `POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}` where `step ∈ {audio, transcribe, summarize, pdf, drive}`. `kind` defaults to `lecture`.

Each endpoint validates that its prerequisite file exists and returns `{"status": "error", "message": "<file> is required — run <previous step> first"}` otherwise.

Timing: `GET /timing/{operation}?file_size_bytes=N` → linear-regression estimate from past runs (or `{"message": "not-enough-data"}`).

## Environment

Reads `.env` (repo root). Required:

- `GROQ_API_KEY` — Groq API key for Whisper transcription
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
- `summarize.py` raises `RuntimeError` on Gemini failure (not `sys.exit`) so the endpoint can catch and return `{"status": "error"}`.
- `transcribe.py` raises `TranscribeRateLimitError` carrying `{limit, used, requested, retry_after_seconds, completed_chunks, total_chunks}` and writes partial state to disk; the next `/run/transcribe` call picks up from `transcript.partial.txt`.
- `timing/` records every pipeline operation's `(file_size, duration)` so the frontend can show calibrated ETAs.
