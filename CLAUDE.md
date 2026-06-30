# CLAUDE.md

Top-level guidance for Claude Code in this repo. Service-specific docs live next to each service.

## What this project is

A four-service app that turns a Hebrew video lecture into a structured written summary (and uploads it to Google Drive). The video → audio → transcript → summary → PDF → Drive pipeline lives in `backend/`; a web UI for driving it lives in `frontend/`; a Chrome extension + helper server for grabbing source videos (and PDFs) off lecture sites lives in `downloader/`; and all filesystem reads/writes under `DATA_ROOT` (plus the cross-service SSE notify channel) are owned by `database/`.

## Repository layout

```
backend/      FastAPI app + pipeline modules (Python).        See backend/CLAUDE.md
frontend/     React + Vite + TS UI (talks to database/).      See frontend/CLAUDE.md
downloader/   Chrome MV3 extension + small Node server.       See downloader/CLAUDE.md
database/     FastAPI service owning all DATA_ROOT I/O + SSE. See database/CLAUDE.md
.env          Shared env file — DATA_ROOT, GROQ_API_KEY, GEMINI_API_KEY, GDRIVE_ROOT_FOLDER
```

All services read the same `.env` at the repo root and share one on-disk layout under `DATA_ROOT`:

```
{DATA_ROOT}/{course}/{lecture}/...                  # lectures
{DATA_ROOT}/{course}/Recitations/{name}/...         # recitations
```

`database/` is the single source of truth for this layout. When changing paths, file names, or course/recitation conventions, update it there — the other services hold no path conventions and reach disk only by calling the database service.

## Running the dev stack

All four services boot in one terminal via `concurrently`:

```bash
npm run dev
```

Logs are prefixed `Backend` / `Frontend` / `Downloader` / `Database` and color-coded; Ctrl-C kills all four. The script is defined in the root `package.json`. Per-service commands and ports are documented in each service's CLAUDE.md.

## Always use `python3`

`python` is not aliased on this WSL setup — always invoke `python3` explicitly.

## Documentation and code style

- Document the non-obvious WHY: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader. Skip comments that just restate what the code says.
- For non-trivial helpers, prefer a 2–3 line comment that contrasts the failure mode with the fix. Show, don't explain. See `normalize_math_spans` and `force_ltr_inline_code` in `backend/pipeline/to_pdf.py` for the canonical pattern:
  ```python
  # One sentence stating the failure condition.
  # Before: <concrete input>  -> <bad output / error>
  # After:  <concrete input>  -> <good output>
  ```
- Never write multi-paragraph docstrings or multi-line comment blocks to fill space — one short line is the default; the before/after pattern is the upgrade when the WHY is non-obvious.
