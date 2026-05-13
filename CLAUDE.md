# CLAUDE.md

Top-level guidance for Claude Code in this repo. Service-specific docs live next to each service.

## What this project is

A three-service app that turns a Hebrew video lecture into a structured written summary (and uploads it to Google Drive). The video → audio → transcript → summary → PDF → Drive pipeline lives in `backend/`; a web UI for driving it lives in `frontend/`; and a Chrome extension + helper server for grabbing source videos off lecture sites lives in `downloader/`.

## Repository layout

```
backend/      FastAPI app + pipeline modules (Python).        See backend/CLAUDE.md
frontend/     React + Vite + TS UI with a Vite-plugin fs API. See frontend/CLAUDE.md
downloader/   Chrome MV3 extension + small Node server.       See downloader/CLAUDE.md
.env          Shared env file — DATA_ROOT, GROQ_API_KEY, GDRIVE_ROOT_FOLDER
```

All three services read the same `.env` at the repo root and share one on-disk layout under `DATA_ROOT`:

```
{DATA_ROOT}/{course}/{lecture}/...                  # lectures
{DATA_ROOT}/{course}/Recitations/{name}/...         # recitations
```

When changing anything that touches paths, file names, or course/recitation conventions, update **all three** services — they each encode this layout independently.

## Running the dev stack

All three services boot in one terminal via `concurrently`:

```bash
npm run dev
```

Logs are prefixed `Backend` / `Frontend` / `Downloader` and color-coded; Ctrl-C kills all three. The script is defined in the root `package.json`. Per-service commands and ports are documented in each service's CLAUDE.md.

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
