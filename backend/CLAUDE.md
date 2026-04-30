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
    strip_audio.py    — strip_audio(video_path, audio_path)
    transcribe.py     — transcribe_audio(audio_path, api_key) → str
    summarize.py      — summarize(transcript) → str
    to_pdf.py         — convert_to_pdf(md_path) → str (output path)
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

## API endpoints

All endpoints: `POST /courses/{course}/lectures/{lecture}/run/{step}`

Steps: `audio`, `transcribe`, `summarize`, `pdf`, `all`

## Environment

`.env` (at repo root or backend root) must define:
- `DATA_ROOT` — absolute path to the data directory
- `GROQ_API_KEY` — Groq API key for Whisper transcription

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

## Key design decisions

- Pipeline functions are pure: they take file paths / strings, no global state.
- Asset paths (`fonts/`, `summarize.md`, `pandoc_template.tex`) are resolved relative to `__file__` inside each pipeline module — they point to `backend/assets/`.
- CORS is open to `http://localhost:5173` only.
- No background tasks, no job polling — every endpoint blocks until done.
- `summarize.py` raises `RuntimeError` on Gemini failure (not `sys.exit`) so the endpoint can catch and return `{"status": "error"}`.
