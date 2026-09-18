# Fast Study

Turns a Hebrew video lecture into a structured written summary and uploads it to Google Drive.

**Pipeline:** video → audio → transcript → summary (Markdown) → PDF → Google Drive

## Architecture

| Service              | Stack             | Dev port | Role                                                                  |
| -------------------- | ----------------- | -------- | --------------------------------------------------------------------- |
| `database/`          | FastAPI (Python)  | 8001     | Owns every read/write under `DATA_ROOT`, plus the cross-service SSE bus |
| `backend/`           | FastAPI (Python)  | 8000     | Runs the pipeline steps, timing stats and the course runner           |
| `frontend/`          | React + Vite + TS | 5173     | Web UI that drives the pipeline                                       |
| `downloader/server/` | Node (express)    | 3052     | Downloads source videos and PDFs and hands them to `database/`        |
| `downloader/auto/`   | Node (Playwright) | 3053     | Discovers a Moodle course's recordings and handouts                   |

Beside them: `electron/` is the desktop launcher, `delivery/` builds the Windows installer, and `lib/`
holds the modules several services share. Each folder's `CLAUDE.md` is its developer doc.

Lectures live at `{DATA_ROOT}/{course}/{lecture}/`, recitations at
`{DATA_ROOT}/{course}/Recitations/{name}/` — see [`database/docs/LAYOUT.md`](database/docs/LAYOUT.md).

## Requirements

- [uv](https://docs.astral.sh/uv/) (fetches Python 3.12) and Node.js 22
- `ffmpeg` — `sudo apt install ffmpeg`
- `pandoc` **2.9.2.1** — `sudo apt install pandoc`; 3.x breaks the render, see [pinned tool versions](delivery/docs/RELEASE.md#pinned-tool-versions)
- [`tectonic`](https://github.com/tectonic-typesetting/tectonic/releases) on your PATH — a self-contained XeTeX; the first render fetches its packages once, later renders are offline
- `yt-dlp` — only for YouTube sources
- Chrome or Edge — for `downloader/auto/`, plus `Xvfb` on Linux for Zoom capture
- [Groq API key](https://console.groq.com) (transcription) and [Gemini API key](https://aistudio.google.com/apikey) (summary)
- Google OAuth client at `backend/credentials.json` — Drive upload

Hebrew fonts ship in `backend/assets/fonts/`. A missing binary disables only the feature that needs it;
each service reports its tools on `/health`.

## Configuration

One `.env` at the repo root, shared by every service. The app's settings page edits it too.

```
DATA_ROOT=/absolute/path/to/data
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
GDRIVE_ROOT_FOLDER=FastStudy
```

Optional keys (models, Drive toggle, auto-run, ports, peer URLs) are listed in each service's `CLAUDE.md`.

## Running

```bash
npm install     # once: root dev tools, and links lib/ into the services
npm run dev     # every service in one terminal, hot reload; Ctrl-C stops all
npm run app     # builds the frontend, then runs everything under the Electron launcher
```

`npm run app` runs the services the way the installed app does — ephemeral ports, a launch secret —
so a UI change needs it rerun; `npm run dev` is the edit loop.

The Chrome extension is dev-only: load `downloader/extension/regular` unpacked, then set
`DOWNLOADER_EXTENSION_ID` in `.env` to the ID Chrome assigned. Full guide:
[`downloader/README.md`](downloader/README.md).

## Tests

CI runs every suite on each push. Locally, from each folder:

| Where                                      | Command                   |
| ------------------------------------------ | ------------------------- |
| `backend/`, `database/`                    | `uv run pytest tests/ -q` |
| `lib/runtime/py`, `lib/tools/py`, `lib/logging/py` | `uv run --extra test pytest tests/ -q` |
| `frontend/`, `electron/`, `downloader/server`, `downloader/auto` | `npm test`  |
| repo root (`lib/*/js`)                     | `npm test --workspaces`   |

`npm run lint` at the root lints everything.

## Customizing the summary

Edit `backend/assets/instructions/summarize.md` — the Hebrew prompt sent to Gemini with the transcript
and any material PDFs attached to the lecture. No code change needed.

We will support prompt customization in-app soon.
