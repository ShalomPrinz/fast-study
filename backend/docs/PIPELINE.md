# Per-lecture pipeline

`pipeline/`'s stages, run and lock model; the per-course counterpart is [OVERVIEW.md](OVERVIEW.md).

## Stages

| Step         | Output           | Notes                                                                                     |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `audio`      | `audio.mp3`      | ffmpeg → mono 16 kHz 32 kbps. Minimal size, enough for ASR.                               |
| `transcribe` | `transcript.txt` | Groq `whisper-large-v3`, Hebrew, 10-min chunks overlapping by 10 s (Groq caps a request at 25 MB). Chunks are frame copies of `audio.mp3`, never re-encoded; `verbose_json` segment timestamps split each overlap at its midpoint so no boundary text repeats. Chunk count comes from `services/mp3.py`, an in-process header parse rather than a spawned probe. |
| `summarize`  | `summary.md`     | Gemini via `google-genai`; transcript (+ every material PDF) uploaded as file parts.  |
| `pdf`        | `summary.pdf`    | pandoc → `.tex` → tectonic (one run). See [PDF.md](PDF.md).                                      |
| `drive`      | `drive_url.txt`  | Uploads to `{GDRIVE_ROOT_FOLDER}/{course}/[Recitations/]`, writes the share link. Runs only while `DRIVE_ENABLED` is on, and only with Drive connected. |

Other files in a lecture dir: `video.mp4` (user/downloader), any number of material PDFs (user, optional), `transcript.partial.txt` + `transcript.partial.meta.json` (transcribe, on failure), `.pdf_warning` + `.pdf_build.tex` (pdf, on a recovered or failed render — see [PDF.md](PDF.md)).

A LaTeX error that still yielded a usable PDF is **not** a step failure: `_exec_pdf` returns `done` and persists the warning to `.pdf_warning`, so the run continues to `drive`. The runner stays error-only — there is no warning channel in `/status`.

Drive consent never happens inside a run. `services/google_auth.py` only loads and refreshes the stored token, so a drive step with none raises `DriveNotConnected` before it fetches the PDF: the lecture stops at `summary.pdf` and nothing waits on a human. That first failure sets one process flag, reported as `consent_needed` on `GET /config/drive/status` and pushed over SSE, so a queue of N lectures leaves the UI one thing to render; the consent flow itself is `POST /config/drive/connect` ([API.md](API.md)).

A lecture may hold any number of material PDFs. `database/` owns their naming, so the backend never constructs one: `_exec_summarize` lists them via `db_client.list_materials`, downloads each into the workspace and passes them all to `summarize`. The step result's `usedMaterial` stays a bool — true iff at least one reached Gemini.

Gemini auth uses `GEMINI_API_KEY`: the SDK silently ignores OAuth `credentials=` outside Vertex AI mode. The model is `settings.gemini_model()` — `LLMClient`'s default, so summarize and the course overview cannot drift apart.

No environment variable redirects a provider call: both SDK clients get `providers.base_url()` explicitly and Gemini gets `vertexai=False`, because the launcher passes its whole environment to every child, so a stray `GROQ_BASE_URL` / `GOOGLE_GEMINI_BASE_URL` / `GOOGLE_GENAI_USE_VERTEXAI` on a user's machine would otherwise reroute calls the key probe never checked. Proxy and CA variables stay honored.

## The database round-trip

`kind="recitation"` is forwarded to `database/` as a query string, so it injects the `Recitations/` segment. `runner._db_workspace` bridges the pure functions to it: a tempdir per step that pre-downloads named inputs and uploads named outputs on clean exit — ffmpeg, pandoc and Gemini need real filesystem paths.

Writes never create a lecture dir: on one deleted mid-run `database/` answers `lecture_not_found`, which `db_client` forwards as the step's error, so the run stops there instead of re-listing the vanished lecture. `summarize` writes with `put_summary(..., fresh=True)`, so the database drops the editor's revert snapshot and Restore original can only return this output.

## Empty-file guard

A pipeline file is never legitimately 0 bytes; when one is, the producing tool returned success with no content and raised nothing to explain it. `_require_nonempty` rejects 0-byte data at every workspace read and write, and `EMPTY_FILE_ISSUES` supplies the likely cause per filename. Without it a 0-byte file counts as "exists" for `next_step` and the run advances, surfacing a misleading downstream error instead. All six are one code, `empty_file`, carrying `{file}` only — the hints are sentence fragments and stay in the English prose.

Material PDFs are the exception: they are user-supplied optional inputs with no producing step, so an empty one is skipped with a warning and the run continues on the remaining materials (or transcript-only).

## Execution model

Outcomes of the fire-and-forget endpoints live in runner state, read via `GET /status`. State in `pipeline/runner.py`:

- `_locks[(course, lecture, kind)]` — one `asyncio.Lock` per lecture, serializing concurrent triggers.
- `_in_flight[skey]` — all in-flight entries regardless of trigger (runner / `/pipeline` / single `/run/{step}` all populate the same map, so the frontend doesn't care which path queued them). `skey` is the string `"course||lecture||kind"` and appears verbatim in `/status`. A pipeline keeps its lecture in the map from the first step's start until it ends — success, early stop, error or exception — and each step start only rewrites `step`, so `/status` never shows it idle between steps; a lone `/run/{step}` clears it when that step ends. Under `run_all` a lecture that finishes cleanly stays in the map as `_handover` until the next step start (normally the next lecture's first) removes it in the same update that adds its own entry, so `/status` never reads empty between two lectures. Every other way out clears it at once: a step error, an exception and a block stop clear the lecture itself and notify as before, and `run_all` clears a still-held previous lecture (one notify) after an entry that started no step — nothing to do, an `audio` entry already done, a lock-held skip, a crash before the first step — and at its own end.
- `_errors[skey]` — last error as `{step, message, code, params, provider, blocked}`, survives after `_in_flight` clears; cleared when that lecture next starts a step. A summarize start from any trigger also drops every record whose `code` is in `_GEMINI_QUOTA_CODES` and lifts `_summarize_block`, since it re-tests the quota; a transcribe start does the same for `_GROQ_LIMIT_CODES` and `_transcribe_block`. The sweep tests membership of those sets: a code one does not cover would strand every lecture the run stopped, whose record no later attempt would clear. `provider` is `gemini` or `groq` on those codes.
- `_summarize_block` — the `{message, params}` of the Gemini daily quota that stops `run_all` from summarizing further lectures; each one it stops gets `gemini_quota_blocked` with those same params in `_errors`, with `blocked: true`. Reset at every run's start and end, and by any summarize start.
- `_transcribe_block` — the same for Groq's rate limit: it stops `run_all` before it transcribes further lectures, each stopped one getting `groq_rate_limit_blocked` with the hit lecture's params and `blocked: true`. Reset at every run's start and end, and by any transcribe start.
- `_runner_status` — `{running, total, done, last_error}` for `run_all`; `last_error` is a crashed lecture as `{message, code, params}` (`run_crashed`), or `null`.
- `_queue` — the ordered `QueueEntry(course, lecture, kind, depth)` list `run_all` drains. In memory only: a restart empties it, and those lectures simply fall back to "has work left, nothing scheduled", which the frontend derives from the tree.

`next_step` is pure file-existence over `enabled_steps()`: the first step whose output is missing. That makes every trigger resumable with no stored progress.

`db_client.notify()` fires an SSE ping on each meaningful state change (step start, error, pipeline end, a lone `run_step`'s step done, run start/complete) so the frontend reacts without polling; inside a pipeline a finished step pings only through the next step's start or the pipeline's end, and under `run_all` a finished lecture pings only through the next lecture's first step start. It is deliberately NOT fired at `run_all` start or at the end of a lecture where no step ran (beyond the one that clears a held previous lecture): with `_in_flight` still empty those pings burst, and their parallel refreshes can reorder and overwrite the fresher snapshot.

The backend also notifies once at startup, so a page still showing a step a restarted process was running refetches the now-empty `in_flight`.

`enabled_steps()` is `STEP_ORDER` minus the steps a setting switches off — only `drive`, on `DRIVE_ENABLED`. It is read per call, so `POST /config` flips the step without a restart. With Drive off a lecture is complete at `final_output()` = `summary.pdf`; completion stays pure file existence rather than gaining a marker file, and the cost is that turning Drive back on re-pends every lecture that finished while it was off.

## One queue

Every automatic trigger feeds one sequential queue rather than a task per lecture — a section download of twelve lectures would otherwise start twelve concurrent pipelines.

`enqueue(entry)` is the single point of entry. It refuses a lecture that is already queued, already in `_in_flight`, or whose lock a concurrent trigger holds, and starts `run_all` when the runner is idle — flipping `_runner_status["running"]` itself and resetting `done`, `total` (to 1) and `last_error`, so the answer to a run's first enqueue never carries the previous run's counters, because the task it creates only starts at the next await and a burst of arrivals would otherwise each start a drain.

`run_all` takes no argument: it drains `_queue` until empty, so a video arriving mid-run joins that run instead of racing it, and `enqueue` bumps `_runner_status["total"]` the moment a lecture joins a live run (the arrival's `notify()` pushes it); `run_all` also recomputes it from `done + len(_queue)` before each pop, so an entry a manual run pulled out drops from the count. A lecture whose lock is already held is skipped rather than awaited. A manual run (`try_run_step` / `try_run_pipeline`) that starts a queued lecture pulls its entry out of `_queue`, so it runs now, alongside the drain, and the queue never re-runs it. `move_to_front` (`POST .../queue/front`) only reorders: it moves an entry to index 0, which `run_all` pops next, and notifies only when the order changed.

`depth` is how far that entry may go: `full` is `run_pipeline_for(..., honor_block=True)`, `audio` is the single `audio` step and nothing after it (skipped outright when `audio.mp3` is already there). `scan_pending` still walks the tree for lectures with `video.mp4` but no `final_output()` and returns bare `(course, lecture, kind)`; the depth is attached at each call site.

## `AUTO_RUN` — the ceiling on automatic work

`settings.auto_run()` returns `off`, `audio` or `full`; unset or unrecognised means `full`, so a typo can never silently stop every unattended run.

| Value   | A video arriving (`/video-arrived`) | The nightly cron                                |
| ------- | ----------------------------------- | ----------------------------------------------- |
| `off`   | logged and dropped                  | does nothing, not even a scan                   |
| `audio` | queued at depth `audio`             | scans and queues at depth `audio`               |
| `full`  | queued at depth `full`              | scans and queues at depth `full`                |

It never caps a run the user asked for: `POST /run-all` always enqueues at depth `full`.

The uploading service reports the arrival as a fact and holds no step names — the depth is the backend's alone.

## The nightly catch-up pass

`pipeline/schedule.py` owns the APScheduler instance that fires `_scheduled_run` once a day. It lives there, not in `backend_main.py`'s lifespan, so `POST /config` can re-apply the settings on the running process: `apply()` adds, reschedules or removes the single `run_all_daily` job and is idempotent, so the endpoint calls it unconditionally.

`settings.nightly_run()` is the switch and `settings.nightly_hour()` the hour. Unset means on at 03:00, and an hour that is non-numeric or outside 0-23 falls back to 03:00 rather than leaving the install with no nightly pass. The store validates an integer, not an hour; the range is enforced here.

`NIGHTLY_RUN` and `AUTO_RUN` are independent gates and are deliberately not merged: `AUTO_RUN` is the depth ceiling on _all_ unattended work, `NIGHTLY_RUN` switches off only this pass. `AUTO_RUN=off` still stops the scheduled run from inside `_scheduled_run`.

## Rate limits

No step sleeps or retries on a rate limit: the step records the error, releases the lecture's lock, and the user decides when to retry.

**Groq / transcribe.** `transcribe_audio` raises `TranscribeRateLimitError` (a `CodedError`, `groq_rate_limited`, params `{limit, used, requested, retry_after_seconds}` parsed from Groq's prose message) and leaves `transcript.partial.txt` + `.meta.json` on disk. The executor returns it as an error flagged `groq_limit`, which sets the run-scoped `_transcribe_block`: every later lecture in the same `run_all` stops before transcribing, carrying the same record so it reads as blocked rather than pending. A manual `/run/transcribe` or `/pipeline` trigger still runs and clears the block. The next transcribe continues from the partial.

Resume validates the meta against `audio.mp3`'s size AND mtime. Re-downloading audio gives it a fresh mtime, so the transcribe executor restores the mtime recorded in the partial meta — otherwise every resume silently falls back to a full restart.

**Gemini / summarize.** `LLMClient.generate` parses a 429 body into `GeminiRateLimitError` (`{quota_id, quota_value, model, is_daily}`) instead of leaking the SDK's JSON blob. Those same facts ride the wire as the `gemini_quota_exhausted` params `{scope, model, limit, tier}` (`quota_params`), so the sentence is a renderer's to build rather than the backend's. The 429's `retryDelay` is never parsed — the quota kind says everything actionable, and a daily quota's `retryDelay` lies (claims 59s, actually resets at midnight Pacific).

- Per-minute quota → plain `gemini_quota_exhausted` error (`scope: per_minute`) that stops only its lecture; no run-wide block.
- Daily quota (`quotaId` containing `PerDay`, or anything unrecognised — the safe default) → plain error. It also sets the run-scoped `_summarize_block` so every later lecture in the same `run_all` stops at `transcript.txt` without calling Gemini, carrying the same quota record so it reads as blocked rather than pending. Audio+transcribe are Groq (separate quota) so the queue still gets fully transcribed, and tomorrow's run resumes each lecture at summarize.

Manual `/run/summarize` and `/pipeline` triggers ignore both blocks — the user may have swapped keys.

## Timing

`timing/` logs `(operation, file_size_bytes, duration_seconds)` to a SQLite db via the `@timed_pipeline` decorator; `get_stats` returns a linear-regression ETA. See [timing/README.md](../timing/README.md) for queries and the outlier-cleaning scripts.

The db sits at `runtime.state_path("timing.db")`, outside the `backend/` tree `--reload` watches, so the runner's constant writes never restart the dev server. `timing/__init__.py` owns that path and `init_db()` creates the directory — `state_path` itself only joins.

## Logging

`backend_main.py` calls `setup_logging()` at import; the format, the dropped access lines and why it owns `uvicorn.access` are [lib/logging](../../lib/logging/CLAUDE.md)'s. The silenced `httpx` INFO line would otherwise print once per Groq chunk.
