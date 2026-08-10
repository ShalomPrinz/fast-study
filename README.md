# Fast Study

Turns a Hebrew video lecture into a structured written summary and uploads it to Google Drive.

**Pipeline:** video → audio → transcript → summary (Markdown) → PDF → Google Drive

## Architecture

Four services share one `.env` and one on-disk layout under `DATA_ROOT`:

| Service       | Stack                    | Port | Role                                                                            |
| ------------- | ------------------------ | ---- | ------------------------------------------------------------------------------- |
| `backend/`    | FastAPI (Python)         | 8000 | Runs the pipeline steps; serves timing stats and the resume runner              |
| `database/`   | FastAPI (Python)         | 8001 | Owns every read/write under `DATA_ROOT` + the cross-service SSE bus             |
| `frontend/`   | React + Vite + TS        | 5173 | Web UI that drives the pipeline                                                 |
| `downloader/` | Chrome MV3 + Node server | 3052 | Captures source videos (and PDFs) from lecture sites and hands them to database |

On-disk layout (single source of truth: `database/fs/paths.py`):

```
{DATA_ROOT}/{course}/{lecture}/...                  # lectures
{DATA_ROOT}/{course}/Recitations/{name}/...         # recitations
```

Per-service docs live next to each service in `CLAUDE.md`.

## Requirements

- Python 3.12+
- Node.js 18+
- `ffmpeg` — `sudo apt install ffmpeg`
- `pandoc` — `sudo apt install pandoc`
- XeLaTeX — `sudo apt install texlive-xetex texlive-lang-arabic`
- `yt-dlp` (only if you'll download from YouTube) — `pipx install yt-dlp` or `sudo apt install yt-dlp`
- [Groq API key](https://console.groq.com) — Whisper transcription
- [Gemini API key](https://aistudio.google.com/apikey) — summary generation
- Google OAuth client (`backend/credentials.json`) — Drive upload

The Hebrew fonts (Noto Sans Hebrew for body text, Miriam Mono CLM for code) are bundled in `backend/assets/fonts/` — no system font install needed.

## Environment

Single `.env` at the repo root, shared by all services:

```
DATA_ROOT=/absolute/path/to/data
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
GDRIVE_ROOT_FOLDER=FastStudy
# Optional overrides
DATABASE_URL=http://localhost:8001
BACKEND_URL=http://localhost:8000
```

The frontend has its own `frontend/.env` for `VITE_API_URL` / `VITE_DATABASE_URL` (both optional — defaults match the ports above).

## Running

All four services boot in one terminal:

```bash
npm install        # one-time, installs concurrently
npm run dev
```

Logs are prefixed `Backend` / `Frontend` / `Downloader` / `Database` and color-coded; Ctrl-C kills all four. Per-service commands live in each service's `CLAUDE.md`.

The Chrome extension is loaded unpacked from `downloader/extension/regular`. After loading, set `DOWNLOADER_EXTENSION_ID` in the repo-root `.env` to the ID Chrome assigned, or CORS will block the popup. See `downloader/README.md` for the full install guide.

## Tests

The backend uses [uv](https://docs.astral.sh/uv/) (manages Python 3.12 + deps); CI runs the same command on every push/PR.

```bash
cd backend && uv run pytest tests/ -q
```

## Customizing the summary format

Edit `backend/assets/instructions/summarize.md` — it's the Hebrew prompt sent to Gemini alongside the transcript (and every material PDF attached to the lecture, if any). No code change needed.
