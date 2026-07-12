# Downloader — Install Guide (Windows)

A Chrome extension that grabs lecture videos (and PDFs) off the page you're watching. Two completely separate variants live in this folder:

- **Full setup** (`downloader/extension/regular` + `downloader/server`) — Chrome extension + Node server. Files land directly inside the `fast_study` app and the pipeline picks them up automatically. Supports YouTube via `yt-dlp`.
- **Simple setup** (`downloader/extension/simple/`) — Chrome extension only, **no Node.js, no server, no other services**. Files save to `Downloads\fast_study\<your file name>.<ext>`.

Pick the one that matches you below.

---

## For Non-Technical Users (Simple — no Node.js)

You only need **Google Chrome**. Nothing else. You'll be loading the **`extension\simple`** subfolder as a Chrome extension.

### What you'll get

Every time you click *Download* in the extension, a file lands at:

```
C:\Users\<you>\Downloads\fast_study\<your file name>.mp4
C:\Users\<you>\Downloads\fast_study\<your file name>.pdf
```

You type the file name you want — that's the only input.

### Install — one time

1. **Download this folder** to your computer. If you got it as a ZIP, right-click → *Extract All...* and remember where you put it (e.g. `C:\Users\<you>\Documents\fast_study`).
2. Open Google Chrome and go to: `chrome://extensions`
3. In the top-right, turn on **Developer mode**.
4. Click **Load unpacked** (top-left).
5. Pick the **`downloader\extension\simple`** folder (not the parent `downloader` folder). The extension *Fast Study Downloader (Simple)* should now appear in the list.
6. (Optional) Click the puzzle-piece icon in Chrome's toolbar and pin the extension so its icon stays visible.

That's it. No installs, no terminal, no servers.

### How to use it

1. Open the lecture page (any site that streams `.mp4` video, or a `.pdf` page) in Chrome.
2. Wait a few seconds — let the video start playing. A small red number appears on the extension icon when it has detected the video.
3. Click the extension icon.
4. Type a **File name** (e.g. `Calculus Lecture 3`).
5. Click **Download**.
6. Chrome saves the file under `Downloads\fast_study\<your file name>.mp4` (or `.pdf`).

> ⚠️ **YouTube videos don't work in standalone mode.** YouTube splits video and audio into separate signed streams that need extra software (`yt-dlp`) to reassemble. If you need YouTube, use the full setup below.

### Troubleshooting

- **"No .mp4 nor .pdf found on this page"** — refresh the page and let the video start playing for a few seconds before opening the popup.
- **File didn't save** — check the bottom-left download bar in Chrome; the file might be blocked. Click *Keep*.
- **YouTube doesn't work** — correct, the simple version doesn't support YouTube. Use the full setup if you need it.

---

## For Technical Users (full setup, with Node.js)

This is the full pipeline integration: the extension talks to a tiny local Node server (`server/server.js`), which calls `curl` (or `yt-dlp` for YouTube), and writes the file directly into the `fast_study` data tree via the database service. Auto-triggers the rest of the pipeline.

### Requirements (Windows)

| Tool | Why | Install on Windows |
|---|---|---|
| **Node.js 18+** | Runs `server/server.js` | <https://nodejs.org/> — pick the LTS Windows Installer |
| **curl** | Replays captured headers to download `.mp4` | Already bundled with Windows 10/11 (`curl.exe` in `System32`) |
| **yt-dlp** | YouTube downloads | `winget install yt-dlp` (or download `yt-dlp.exe` from <https://github.com/yt-dlp/yt-dlp/releases> and add it to PATH) |
| **Google Chrome** | The extension | <https://www.google.com/chrome/> |

The Node server itself has **zero npm dependencies** — no `npm install` step needed.

### Install — one time

1. **Clone or download** the `fast_study` repo to disk (e.g. `C:\Users\<you>\fast_study`).
2. Make sure the rest of the stack is set up per the top-level `README` / `CLAUDE.md`. The downloader needs the **database service** running (default `http://localhost:8001`); set `DATABASE_URL` in the repo-root `.env` if it differs.
3. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode** (top-right)
   - **Load unpacked** → select the **`downloader\extension\regular`** folder (not `extension\simple`)
   - Pin the extension to the toolbar (optional but recommended)
4. Note the **extension ID** Chrome assigned (looks like `abcdefghijklmnop...` on the extensions page). Open `downloader\server\server.js` and set the `EXTENSION_ID` constant to that value, or CORS will block the popup.

### Run

From a PowerShell or Command Prompt in the repo root:

```powershell
npm run dev
```

That boots backend + frontend + downloader + database together. Logs prefixed `Downloader` show on port `3052`.

Or, downloader-only:

```powershell
cd downloader\server
npm start
```

### How to use it

1. Open a lecture page in Chrome — any streaming site with `.mp4` video, a YouTube video, or a `.pdf` page.
2. Click the extension icon.
3. The Course / Lecture fields autocomplete from your existing data tree. Pick or type a target.
4. Click **Download**.
5. The server fetches the file and hands it off to the database service. The frontend sidebar refreshes automatically (via SSE) when it lands.

### What lands where

| Source | Saved as |
|---|---|
| Captured `.mp4` (lecture) | `{DATA_ROOT}\{Course}\{Lecture}\video.mp4` |
| Captured `.mp4` (recitation) | `{DATA_ROOT}\{Course}\Recitations\{Name}\video.mp4` |
| YouTube | Same paths, via `yt-dlp` |
| PDF | `...\{Lecture}\material.pdf` |

### Troubleshooting

- **Popup says "Server offline - start `npm start` in downloader/"** — start the server with `npm start` in `downloader\server\` (or `npm run dev` at the repo root).
- **CORS error in DevTools** — the extension ID changed. Update `EXTENSION_ID` in `server\server.js` and restart.
- **YouTube downloads fail** — confirm `yt-dlp --version` works in your terminal. Recent versions also need Node.js on PATH for YouTube's player script (which you already have).
- **Headers replay fails with 403** — the captured request expired. Reload the lecture page, let the video play a few seconds, then try again.

---

## Which one should I use?

| | Simple (`extension/simple/`) | Full (`extension/regular` + `server/`) |
|---|---|---|
| Installs needed | Chrome only | Chrome + Node.js (+ `yt-dlp` for YouTube) |
| YouTube support | ❌ | ✅ |
| Files auto-flow into the app | ❌ (manual move) | ✅ |
| Time to install | ~2 min | ~10 min |

> ⚠️ Only load **one** of the two extensions at a time. Both listen on `<all_urls>` for `.mp4` requests — running them together just means two popups doing the same job.
