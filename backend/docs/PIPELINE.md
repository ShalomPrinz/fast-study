# Per-lecture pipeline

`pipeline/` holds per-LECTURE logic; `course/` holds per-COURSE logic (see `OVERVIEW.md`). Anything aggregating across a course's lectures never belongs here.

## Stages

| Step         | Output           | Notes                                                                                     |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `audio`      | `audio.mp3`      | ffmpeg → mono 16 kHz 32 kbps. Minimal size, enough for ASR.                               |
| `transcribe` | `transcript.txt` | Groq `whisper-large-v3`, Hebrew, 10-min chunks (Groq caps a request at 25 MB).            |
| `summarize`  | `summary.md`     | Gemini via `google-genai`; transcript (+ optional `material.pdf`) uploaded as file parts. |
| `pdf`        | `summary.pdf`    | pandoc + XeLaTeX. See `PDF.md`.                                                           |
| `drive`      | `drive_url.txt`  | Uploads to `{GDRIVE_ROOT_FOLDER}/{course}/[Recitations/]`, writes the share link.         |

Other files in a lecture dir: `video.mp4` (user/downloader), `material.pdf` (user, optional), `transcript.partial.txt` + `transcript.partial.meta.json` (transcribe, on rate-limit).

The Hebrew summarize prompt lives at `assets/instructions/summarize.md` — edit the file to change output structure, no code change. Gemini auth uses `GEMINI_API_KEY`: the SDK silently ignores OAuth `credentials=` outside Vertex AI mode.

## Purity and the database round-trip

Pipeline functions are pure — paths/strings in, no global state, no knowledge of `DATA_ROOT`. Every filesystem access goes through `services/db_client.py` (HTTP to `database/`, port 8001). The only identity the backend carries is `(course, lecture, kind)`; `kind="recitation"` is forwarded as a query string so the database service injects the `Recitations/` segment.

`runner._db_workspace` is the bridge: a `tempfile.TemporaryDirectory` per step that pre-downloads named inputs and uploads named outputs on clean exit. ffmpeg/pandoc/Gemini need real filesystem paths, so the bytes have to land somewhere.

Asset paths (`assets/fonts`, `assets/instructions`, `assets/templates`) resolve relative to `__file__`.

## Empty-file guard

A pipeline file is never legitimately 0 bytes; when one is, the producing tool returned success with no content and raised nothing to explain it. `_require_nonempty` rejects 0-byte data at every workspace read and write, and `EMPTY_FILE_ISSUES` supplies the likely cause per filename. Without it a 0-byte file counts as "exists" for `next_step` and the run advances, surfacing a misleading downstream error instead.

## Execution model

Endpoints are fire-and-forget: they schedule a background asyncio task and return `{"status": "started"|"busy"}`. Outcomes live in runner state, which the frontend reads via `GET /status`.

State in `pipeline/runner.py`:

- `_locks[(course, lecture, kind)]` — one `asyncio.Lock` per lecture, serializing concurrent triggers.
- `_in_flight[skey]` — all in-flight entries regardless of trigger (runner / `/pipeline` / single `/run/{step}` all populate the same map, so the frontend doesn't care which path queued them). `skey` is the string `"course||lecture||kind"` and appears verbatim in `/status`.
- `_errors[skey]` — last error, survives after `_in_flight` clears.
- `_runner_status` — `{running, total, done, last_error}` for `run_all`.

`next_step` is pure file-existence over `STEP_ORDER`: the first step whose output is missing. That makes every trigger resumable with no stored progress.

`scan_pending` walks the tree for lectures with `video.mp4` but no `drive_url.txt`; `run_all` runs that queue sequentially. An APScheduler cron fires it daily at 03:00 (`main.py` lifespan). A lecture whose lock is already held is skipped rather than awaited.

`db_client.notify()` fires an SSE ping on each meaningful state change (step start/done, rate-limit start/wake, error, run start/complete) so the frontend reacts without polling. It is deliberately NOT fired at `run_all` start or per-lecture completion: with `_in_flight` still empty those pings burst, and their parallel refreshes can reorder and overwrite the fresher snapshot.

## Rate limits

**Groq / transcribe.** `transcribe_audio` raises `TranscribeRateLimitError` carrying `{limit, used, requested, completed_chunks, total_chunks}` and leaves `transcript.partial.txt` + `.meta.json` on disk. The runner sleeps `RATE_LIMIT_SLEEP_SECONDS` (3600s — Groq's hourly ASR window) and retries the same step.

Resume validates the meta against `audio.mp3`'s size AND mtime. Re-downloading audio gives it a fresh mtime, so the transcribe executor restores the mtime recorded in the partial meta — otherwise every resume silently falls back to a full restart.

**Gemini / summarize.** `LLMClient.generate` parses a 429 body into `GeminiRateLimitError` (`{quota_id, quota_value, model, is_daily}`) instead of leaking the SDK's JSON blob. The 429's `retryDelay` is never parsed — the quota kind says everything actionable, and a daily quota's `retryDelay` lies (claims 59s, actually resets at midnight Pacific).

- Per-minute quota → normal `rate_limited` path, sleeping `GEMINI_MINUTE_QUOTA_SLEEP_SECONDS`.
- Daily quota (`quotaId` containing `PerDay`, or anything unrecognised — the safe default) → plain error, no retry. It also sets the run-scoped `_summarize_blocked` flag so every later lecture in the same `run_all` stops silently at `transcript.txt`: one error in the UI, not N. Audio+transcribe are Groq (separate quota) so the queue still gets fully transcribed, and tomorrow's run resumes each lecture at summarize.

Manual `/run/summarize` and `/pipeline` triggers ignore the flag — the user may have swapped keys.

## Timing

`timing/` logs `(operation, file_size_bytes, duration_seconds)` to a SQLite db via the `@timed_pipeline` decorator; `get_stats` returns a linear-regression ETA. See `timing/README.md` for queries and the outlier-cleaning scripts.

`--reload` watches `backend/`, and the runner touches `timing.db` constantly, so `npm run dev` sets `UVICORN_RELOAD_EXCLUDE='*.db timing/*'` to mute the noise (uvicorn reads `UVICORN_`-prefixed env vars; it has no config file). Set the same var if launching uvicorn by hand.
