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
- `pandoc` **2.9.2.1** — `sudo apt install pandoc`. The version is pinned; see `PANDOC_VERSION.md`
- `tectonic` — download the release binary from [tectonic-typesetting/tectonic](https://github.com/tectonic-typesetting/tectonic/releases) onto your PATH. It is a self-contained XeTeX and needs no TeX Live install; the first render fetches its LaTeX packages over the network (minutes, once per machine) and every render after that is offline
- `yt-dlp` (only if you'll download from YouTube) — `pipx install yt-dlp` or `sudo apt install yt-dlp`
- [Groq API key](https://console.groq.com) — Whisper transcription
- [Gemini API key](https://aistudio.google.com/apikey) — summary generation
- Google OAuth client (`backend/credentials.json`) — Drive upload

The Hebrew fonts (Noto Sans Hebrew for body text, Miriam Mono CLM for code) are bundled in `backend/assets/fonts/` — no system font install needed.

Every service resolves these binaries off `$PATH` and probes them at startup, reporting what is missing on its `/health`. `FASTSTUDY_BIN_DIR` in the environment overrides that with a directory of bundled binaries, which is what the packaged build sets.

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

The frontend reads no env file. It resolves the four service URLs at runtime from the Electron preload bridge (`frontend/src/services/runtime.ts`), falling back to the dev ports above.

## Running

All four services boot in one terminal:

```bash
npm install        # one-time: the root dev tools, and links lib/ for the services that share it
npm run dev
```

Logs are prefixed `Backend` / `Frontend` / `Downloader` / `Database` and color-coded; Ctrl-C kills all four. Per-service commands live in each service's `CLAUDE.md`.

The Chrome extension is dev-only and not part of the packaged build. It is loaded unpacked from `downloader/extension/regular`; after loading, set `DOWNLOADER_EXTENSION_ID` in the repo-root `.env` to the ID Chrome assigned — there is no default, and unset means the server allowlists no extension origin, so CORS blocks the popup. See `downloader/README.md` for the full install guide.

## Tests

The backend uses [uv](https://docs.astral.sh/uv/) (manages Python 3.12 + deps); CI runs the same command on every push/PR.

```bash
cd backend && uv run pytest tests/ -q
```

The other suites, each in its own package: `cd database && uv run pytest -q`, `npm test` in
`downloader/server` and `downloader/auto`, and `uv run --extra test pytest` in `lib/runtime` and
`lib/logging` — the shared modules four services import.

## Customizing the summary format

Edit `backend/assets/instructions/summarize.md` — it's the Hebrew prompt sent to Gemini alongside the transcript (and every material PDF attached to the lecture, if any). No code change needed.
