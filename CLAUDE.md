# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

Converts a video file into a structured Hebrew summary via a 3-step pipeline:
1. **strip_audio** — extracts mono 16kHz MP3 from video using ffmpeg
2. **transcribe** — splits audio into 10-min chunks and transcribes each via Groq's `whisper-large-v3` API (Hebrew)
3. **summarize** — pipes the transcript into Gemini CLI using the prompt defined in `summarize.md`

## Running the pipeline

```bash
# Full pipeline (recommended)
python3 main.py <video.mp4> [groq_api_key]

# Or set the key as an env var
export GROQ_API_KEY=gsk_...
python3 main.py lecture.mp4
```

Each step can also be run independently:
```bash
python3 strip_audio.py lecture.mp4              # → lecture.mp3
python3 transcribe.py  lecture.mp3 gsk_...      # → lecture_transcript.txt
python3 summarize.py   lecture_transcript.txt   # → lecture_summary.md
```

## Converting a summary to PDF

```bash
python3 to_pdf.py lecture_summary.md   # → lecture_summary.pdf
```

Requires `pandoc` and `xelatex` (`texlive-xetex`) installed system-wide. The Hebrew font (Noto Serif Hebrew) is bundled in `fonts/` — no system font installation needed. Math expressions written in LaTeX syntax (`$...$`, `$$...$$`) render correctly in the PDF.

## Key design decisions

- Audio is extracted at 16kHz mono 32kbps — minimal size, sufficient for speech recognition.
- Groq's 25MB per-request limit is why audio is chunked into 10-minute segments before transcription.
- `summarize.md` contains the full Hebrew prompt sent to Gemini. Edit it to change the output structure or instructions — no code change needed.
- `summarize.py` imports `summarize()` and `transcribe.py` imports `transcribe_audio()` so `main.py` composes them without subprocess calls between scripts.
