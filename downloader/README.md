# Downloader — Install Guide (Windows)

A Chrome extension that grabs lecture videos (and PDFs) off the page you're watching and saves them straight into FastStudy — for universities whose Moodle web service is closed, so the app's own Downloads page can't reach them. The FastStudy app ships it as a folder you load unpacked in Chrome, and the extension finds the running app by itself, with nothing to configure; it reloads itself when the app brings a newer version. Its popup speaks Hebrew or English, following Chrome's language. The rest of this page is the developer setup, running from the repo.

## Setup (with Node.js)

The extension talks to a small local Node server (`server/`), which calls `curl` (or `yt-dlp` for YouTube), and writes the file directly into the `fast_study` data tree via the database service. Auto-triggers the rest of the pipeline.

### Requirements (Windows)

| Tool              | Why                                         | Install on Windows                                                                                                     |
| ----------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Node.js 18+**   | Runs the `server/` service                  | <https://nodejs.org/> — pick the LTS Windows Installer                                                                 |
| **curl**          | Replays captured headers to download `.mp4` | Already bundled with Windows 10/11 (`curl.exe` in `System32`)                                                          |
| **yt-dlp**        | YouTube downloads                           | `winget install yt-dlp` (or download `yt-dlp.exe` from <https://github.com/yt-dlp/yt-dlp/releases> and add it to PATH) |
| **Google Chrome** | The extension                               | <https://www.google.com/chrome/>                                                                                       |

The Node server uses a few npm packages (express, cors, dotenv) — run `npm ci` in `downloader` once (it installs both Node services).

### Install — one time

1. **Clone or download** the `fast_study` repo to disk (e.g. `C:\Users\<you>\fast_study`).
2. Make sure the rest of the stack is set up per the top-level `README` / `CLAUDE.md`. The downloader needs the **database service** running (default `http://localhost:8001`); set `DATABASE_URL` in the repo-root `.env` if it differs. It also talks to the backend (`BACKEND_URL`, default `http://localhost:8000`) to announce each stored video and to post download timing samples — if it's down, the file is still saved, it just won't auto-start the pipeline.
3. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top-right)
   - **Load unpacked** → select the **`downloader\extension`** folder
   - Pin the extension to the toolbar (optional but recommended)

### Run

From a PowerShell or Command Prompt in the repo root:

```powershell
npm run dev
```

That boots backend + frontend + downloader + database together. Logs prefixed `Downloader` show on port `3052`, which is where the extension looks when no FastStudy app is installed.

Or, downloader-only:

```powershell
cd downloader\server
npm start
```

### How to use it

1. Open a lecture page in Chrome — any streaming site with `.mp4` video, a YouTube video, or a `.pdf` page.
2. Click the extension icon.
3. The Course / name fields autocomplete from your existing data tree and suggest the next lecture name. Pick or type a target — a course that doesn't exist yet is created for you.
4. Click **Download**.
5. The server fetches the file and hands it off to the database service. The frontend sidebar refreshes automatically (via SSE) when it lands.

### What lands where

| Source                       | Saved as                                            |
| ---------------------------- | --------------------------------------------------- |
| Captured `.mp4` (lecture)    | `{DATA_ROOT}\{Course}\{Lecture}\video.mp4`          |
| Captured `.mp4` (recitation) | `{DATA_ROOT}\{Course}\Recitations\{Name}\video.mp4` |
| YouTube                      | Same paths, via `yt-dlp`                            |
| PDF                          | `...\{Lecture}\material.pdf` (`material.2.pdf`, … for each further PDF) |

### Troubleshooting

- **Popup says "Open the FastStudy app"** — FastStudy is installed but not running; start it and reopen the popup.
- **Popup says "Can't reach FastStudy"** — open the FastStudy app (`npm run dev` at the repo root), or start the server alone with `npm start` in `downloader\server\`.
- **"No video or PDF on this page"** — reload the lecture page and let the video play a few seconds before opening the popup.
- **YouTube downloads fail** — confirm `yt-dlp --version` works in your terminal. Recent versions also need Node.js on PATH for YouTube's player script (which you already have).
- **Headers replay fails with 403** — the captured request expired. Reload the lecture page, let the video play a few seconds, then try again.
