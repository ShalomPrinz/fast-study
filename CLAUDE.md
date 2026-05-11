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
python3 strip_audio.py lecture.mp4              # → audio.mp3
python3 transcribe.py  audio.mp3 gsk_...      # → transcript.txt
python3 summarize.py   transcript.txt   # → summary.md
```

## Converting a summary to PDF

```bash
python3 to_pdf.py summary.md   # → summary.pdf
```

Requires `pandoc` and `xelatex` (`texlive-xetex`) installed system-wide. The Hebrew font (Noto Serif Hebrew) is bundled in `fonts/` — no system font installation needed. Math expressions written in LaTeX syntax (`$...$`, `$$...$$`) render correctly in the PDF.

## Acquiring source videos (`downloader/`)

A Chrome extension + tiny Node server in `downloader/` captures `.mp4` streams from any web page and saves them as `video.mp4` directly into `{DATA_ROOT}/{course}/{lecture}/` (or `{course}/Recitations/{name}/`), ready for the backend's `/run/audio` step. The popup auto-completes course/lecture names from the existing folders under `DATA_ROOT` and suggests the next lecture name using the same logic as the frontend sidebar. Run `npm start` inside `downloader/` to launch the local server (port 3052); load the extension unpacked in Chrome, hit Play on a video, then click Download. See `downloader/CLAUDE.md` for the architecture and the hardcoded extension-ID gotcha.

## Documentation and code style

- Document the non-obvious WHY — a hidden constraint, a subtle invariant, a workaround for a specific bug, or behavior that would surprise a reader.
- For non-trivial helpers, prefer a 2-3 line comment that contrasts the failure mode with the fix. Show, don't explain. See `normalize_math_spans` and `force_ltr_inline_code` in `backend/pipeline/to_pdf.py` for the canonical pattern:
  ```python
  # One sentence stating the failure condition.
  # Before: <concrete input>  -> <bad output / error>
  # After:  <concrete input>  -> <good output>
  ```
- Never write multi-paragraph docstrings or multi-line comment blocks just to fill space — one short line is the default, the before/after pattern is the upgrade when the WHY is non-obvious.

## Key design decisions

- Audio is extracted at 16kHz mono 32kbps — minimal size, sufficient for speech recognition.
- Groq's 25MB per-request limit is why audio is chunked into 10-minute segments before transcription.
- `summarize.md` contains the full Hebrew prompt sent to Gemini. Edit it to change the output structure or instructions — no code change needed.
- `summarize.py` imports `summarize()` and `transcribe.py` imports `transcribe_audio()` so `main.py` composes them without subprocess calls between scripts.
