# Per-lecture pipeline

`pipeline/` holds per-LECTURE logic; `course/` holds per-COURSE logic (see `OVERVIEW.md`). Anything aggregating across a course's lectures never belongs here.

## Stages

| Step         | Output           | Notes                                                                                     |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `audio`      | `audio.mp3`      | ffmpeg → mono 16 kHz 32 kbps. Minimal size, enough for ASR.                               |
| `transcribe` | `transcript.txt` | Groq `whisper-large-v3`, Hebrew, 10-min chunks (Groq caps a request at 25 MB).            |
| `summarize`  | `summary.md`     | Gemini via `google-genai`; transcript (+ every material PDF) uploaded as file parts.  |
| `pdf`        | `summary.pdf`    | pandoc → `.tex` → XeLaTeX (two passes). See `PDF.md`.                                     |
| `drive`      | `drive_url.txt`  | Uploads to `{GDRIVE_ROOT_FOLDER}/{course}/[Recitations/]`, writes the share link. Runs only while `DRIVE_ENABLED` is on. |

Other files in a lecture dir: `video.mp4` (user/downloader), any number of material PDFs (user, optional), `transcript.partial.txt` + `transcript.partial.meta.json` (transcribe, on rate-limit), `.pdf_warning` + `.pdf_build.tex` (pdf, on a recovered or failed render — see `PDF.md`).

A XeLaTeX error that still yielded a usable PDF is **not** a step failure: `_exec_pdf` returns `done` and persists the warning to `.pdf_warning`, so the run continues to `drive`. The runner stays error-only — there is no warning channel in `/status`.

A lecture may hold any number of material PDFs. `database/` owns their naming, so the backend never constructs one: `_exec_summarize` lists them via `db_client.list_materials`, downloads each into the workspace and passes them all to `summarize`. The step result's `usedMaterial` stays a bool — true iff at least one reached Gemini.

The Hebrew summarize prompt lives at `assets/instructions/summarize.md` — edit the file to change output structure, no code change. Gemini auth uses `GEMINI_API_KEY`: the SDK silently ignores OAuth `credentials=` outside Vertex AI mode. The model is `settings.gemini_model()` — `LLMClient`'s default, so summarize and the course overview cannot drift apart.

## Purity and the database round-trip

Pipeline functions are pure — paths/strings in, no global state, no knowledge of `DATA_ROOT`. Every filesystem access goes through `services/db_client.py` (HTTP to `database/`, port 8001). The only identity the backend carries is `(course, lecture, kind)`; `kind="recitation"` is forwarded as a query string so the database service injects the `Recitations/` segment.

`runner._db_workspace` is the bridge: a `tempfile.TemporaryDirectory` per step that pre-downloads named inputs and uploads named outputs on clean exit. ffmpeg/pandoc/Gemini need real filesystem paths, so the bytes have to land somewhere.

Asset paths (`assets/fonts`, `assets/instructions`, `assets/templates`) resolve relative to `__file__`.

## Empty-file guard

A pipeline file is never legitimately 0 bytes; when one is, the producing tool returned success with no content and raised nothing to explain it. `_require_nonempty` rejects 0-byte data at every workspace read and write, and `EMPTY_FILE_ISSUES` supplies the likely cause per filename. Without it a 0-byte file counts as "exists" for `next_step` and the run advances, surfacing a misleading downstream error instead.

Material PDFs are the exception: they are user-supplied optional inputs with no producing step, so an empty one is skipped with a warning and the run continues on the remaining materials (or transcript-only).

## Execution model

Endpoints are fire-and-forget: they schedule a background asyncio task and return `{"status": "started"|"busy"}`. Outcomes live in runner state, which the frontend reads via `GET /status`.

State in `pipeline/runner.py`:

- `_locks[(course, lecture, kind)]` — one `asyncio.Lock` per lecture, serializing concurrent triggers.
- `_in_flight[skey]` — all in-flight entries regardless of trigger (runner / `/pipeline` / single `/run/{step}` all populate the same map, so the frontend doesn't care which path queued them). `skey` is the string `"course||lecture||kind"` and appears verbatim in `/status`.
- `_errors[skey]` — last error, survives after `_in_flight` clears.
- `_runner_status` — `{running, total, done, last_error}` for `run_all`.
- `_queue` — the ordered `QueueEntry(course, lecture, kind, depth)` list `run_all` drains. In memory only: a restart empties it, and those lectures simply fall back to "has work left, nothing scheduled", which the frontend derives from the tree.

`next_step` is pure file-existence over `enabled_steps()`: the first step whose output is missing. That makes every trigger resumable with no stored progress.

`enabled_steps()` is `STEP_ORDER` minus the steps their setting switches off — today only `drive`, on `DRIVE_ENABLED`. It is read per call, so `POST /config` flips the step without a restart. With Drive off a lecture is complete at `final_output()` = `summary.pdf`; completion stays pure file existence rather than gaining a marker file, and the cost is that turning Drive back on re-pends every lecture that finished while it was off.

## One queue

Every automatic trigger feeds one sequential queue rather than a task per lecture — a section download of twelve lectures would otherwise start twelve concurrent pipelines, each with its own Groq/Gemini rate-limit sleeper.

`enqueue(entry)` is the single point of entry. It refuses a lecture that is already queued, already in `_in_flight`, or whose lock a concurrent trigger holds, and starts `run_all` when the runner is idle — flipping `_runner_status["running"]` itself, because the task it creates only starts at the next await and a burst of arrivals would otherwise each start a drain.

`run_all` takes no argument: it drains `_queue` until empty, so a video arriving mid-run joins that run instead of racing it, and `_runner_status["total"]` is recomputed each iteration from `done + len(_queue)` so a growing queue is reflected. A lecture whose lock is already held is skipped rather than awaited.

`depth` is how far that entry may go: `full` is `run_pipeline_for(..., honor_block=True)`, `audio` is the single `audio` step and nothing after it (skipped outright when `audio.mp3` is already there). `scan_pending` still walks the tree for lectures with `video.mp4` but no `final_output()` and returns bare `(course, lecture, kind)`; the depth is attached at each call site.

## `AUTO_RUN` — the ceiling on automatic work

`settings.auto_run()` returns `off`, `audio` or `full`; unset or unrecognised means `full`, which is the historical behaviour, so a typo can never silently stop every unattended run.

| Value   | A video arriving (`/video-arrived`) | The 03:00 cron                                  |
| ------- | ----------------------------------- | ----------------------------------------------- |
| `off`   | logged and dropped                  | does nothing, not even a scan                   |
| `audio` | queued at depth `audio`             | scans and queues at depth `audio`               |
| `full`  | queued at depth `full`              | scans and queues at depth `full`                |

It never caps a run the user asked for: `POST /run-all` always enqueues at depth `full`.

The database service reports the arrival as a fact and holds no step names — see `database/docs/API.md`. An APScheduler cron fires `_scheduled_run` daily at 03:00 (`main.py` lifespan); the hour is not a setting.

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

## Logging

`services/logging_setup.py` owns all logging config; `main.py` calls `setup_logging()` at import, which lands after uvicorn's own `dictConfig` and wins. It sets the root logger to INFO with `[%(name)s] %(message)s`, silences `httpx`'s per-request INFO line (one per Groq chunk), and rewrites `uvicorn.access` to `[api] POST /path → 200`.

Access lines for `HEAD`, `OPTIONS` (CORS preflights) and for 2xx `GET` are deliberately dropped — the frontend fires those constantly and they carry no information. Those requests still run; only their log line is suppressed. Everything else (any non-2xx, any mutating method) is logged.
