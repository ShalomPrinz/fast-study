# CLAUDE.md — backend

This file provides guidance to Claude Code when working inside `backend/`.

## Always use `python3`

Never use `python` — always `python3` (e.g. `python3 -m pytest`, `python3 main.py`).

## What this is

A FastAPI backend that exposes the lecture-processing pipeline as HTTP endpoints.
Each endpoint runs synchronously (blocking) and returns `{"status": "done"}` or `{"status": "error", "message": "..."}`.

## Directory layout

```
backend/
  assets/
    fonts/            — NotoSansHebrew-Regular.ttf (bundled, no system install needed)
    instructions/     — summarize.md (Hebrew prompt sent to Gemini)
    templates/        — pandoc_template.tex (XeLaTeX template for PDF output)
  pipeline/           — pure functions, one module per step
    strip_audio.py       — strip_audio(video_path, audio_path)
    transcribe.py        — transcribe_audio(audio_path, api_key) → str
    summarize.py         — summarize(transcript) → str
    to_pdf.py            — convert_to_pdf(md_path) → str (output path)
    upload_to_drive.py   — upload_to_drive(pdf_path, course, root_folder_name) → str (webViewLink)
  tests/
    conftest.py       — adds pipeline/ to sys.path so tests can import pipeline modules
    test_to_pdf.py
  main.py             — FastAPI app + uvicorn entry point
  pyproject.toml
```

## File naming convention per lecture

Each lecture lives at `{DATA_ROOT}/{course}/{lecture}/` with these files:

| File | Produced by |
|------|-------------|
| `video.mp4` | (user-provided) |
| `audio.mp3` | `/run/audio` |
| `transcript.txt` | `/run/transcribe` |
| `summary.md` | `/run/summarize` |
| `summary.pdf` | `/run/pdf` |
| (Drive upload) | `/run/drive` |

## API endpoints

All endpoints: `POST /courses/{course}/lectures/{lecture}/run/{step}`

Steps: `audio`, `transcribe`, `summarize`, `pdf`, `drive`

## Environment

`.env` (at repo root or backend root) must define:
- `DATA_ROOT` — absolute path to the data directory
- `GROQ_API_KEY` — Groq API key for Whisper transcription
- `GDRIVE_ROOT_FOLDER` — name of the root Google Drive folder

## Running

```bash
cd backend
uvicorn main:app --reload        # dev
python3 main.py                  # also works
```

## Running tests

```bash
cd backend
python3 -m pytest tests/ -q
```

## Testing after every logic update

Whenever pipeline logic changes (anything under `pipeline/`, or any helper invoked by it), this is non-negotiable:

1. **Run the existing tests first** — `python3 -m pytest tests/ -q`. A green baseline confirms the change didn't break adjacent behavior. If a test fails, fix the code or update the test deliberately — never silently delete or skip it.
2. **Add tests for the new logic** in the matching `tests/test_<module>.py`. Cover: the bug case (a regression test that fails without the fix), the happy path, and at least one edge case (empty input, escape/special chars, boundary between protected and unprotected regions). See `TestNormalizeMathSpans` and `TestForceLtrInlineCode` in `tests/test_to_pdf.py` for the shape.
3. **Re-run the full suite** after adding tests. The PR / commit is not done until `pytest tests/ -q` is green.

This applies even to "small" or "obvious" changes — preprocessing helpers in `to_pdf.py` look trivial but interact with bidi/LaTeX in surprising ways, which is exactly why every helper there has a dedicated test class.

## Key design decisions

- Pipeline functions are pure: they take file paths / strings, no global state.
- Asset paths (`fonts/`, `summarize.md`, `pandoc_template.tex`) are resolved relative to `__file__` inside each pipeline module — they point to `backend/assets/`.
- CORS is open to `http://localhost:5173` only.
- No background tasks, no job polling — every endpoint blocks until done.
- `summarize.py` raises `RuntimeError` on Gemini failure (not `sys.exit`) so the endpoint can catch and return `{"status": "error"}`.
