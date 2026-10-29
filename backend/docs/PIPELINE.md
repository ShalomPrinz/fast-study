# Per-lecture pipeline

`pipeline/`'s stages, run and lock model; the per-course counterpart is [OVERVIEW.md](OVERVIEW.md).

## Stages

| Step         | Output           | Notes                                                                                     |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `audio`      | `audio.mp3`      | ffmpeg → mono 16 kHz 32 kbps. Minimal size, enough for ASR.                               |
| `transcribe` | `transcript.txt` | Groq `whisper-large-v3`, Hebrew, 10-min chunks overlapping by 10 s (Groq caps a request at 25 MB). Chunks are frame copies of `audio.mp3`, never re-encoded; `verbose_json` segment timestamps split each overlap at its midpoint so no boundary text repeats. Chunk count comes from `services/mp3.py`, an in-process header parse rather than a spawned probe. |
| `summarize`  | `summary.md`     | Gemini via `google-genai`; transcript (+ every attached material) uploaded as file parts — or, for a materials-only lecture, the attached materials alone under `summarize_materials.md`. |
| `pdf`        | `summary.pdf`    | pandoc → `.tex` → tectonic (one run). See [PDF.md](PDF.md).                                      |
| `drive`      | `drive_url.txt`  | Uploads to `{GDRIVE_ROOT_FOLDER}/{course}/[Recitations/]`, writes the share link. Runs only while `DRIVE_ENABLED` is on, and only with Drive connected. |

Other files in a lecture dir: `video.mp4` (user/downloader), any number of materials (user, optional), `transcript.partial.txt` + `transcript.partial.meta.json` (transcribe, on failure), `.pdf_warning` + `.pdf_build.tex` (pdf, on a recovered or failed render — see [PDF.md](PDF.md)).

A `fresh` pdf run (`run/pdf?fresh=true`, the editor's save-and-rerender) deletes `summary.pdf` under the lecture's lock before rendering, so a racing run that answers `busy` never leaves the lecture without its PDF; the database's delete also drops `.pdf_warning` and `.pdf_build.tex`.

A LaTeX error that still yielded a usable PDF is **not** a step failure: `_exec_pdf` returns `done` and persists the warning to `.pdf_warning`, so the run continues to `drive`. The runner stays error-only — there is no warning channel in `/status`.

Drive consent never happens inside a run. `services/google_auth.py` only loads and refreshes the stored token, so a drive step with none raises `DriveNotConnected` before it fetches the PDF: the lecture stops at `summary.pdf` and nothing waits on a human. That first failure sets one process flag, reported as `consent_needed` on `GET /config/drive/status` and pushed over SSE, so a queue of N lectures leaves the UI one thing to render; the consent flow itself is `POST /config/drive/connect` ([API.md](API.md)).

A lecture may hold any number of materials of any file type. `database/` owns their naming and per-file meta, so the backend never constructs a name: `_exec_summarize` lists them via `db_client.list_materials`, keeps those `attached_materials` selects, checks sizes, downloads each into the workspace and passes them all to `summarize`. The step result's `usedMaterial` stays a bool — true iff at least one reached Gemini.

**Support table** (`pipeline/material_types.py`, served as `GET /materials/supported`): `pdf` as is; `png`, `jpg`/`jpeg`, `webp`, `heic`/`heif` as their image mime; `txt`, `md`, `csv` as `text/plain`; `docx`, `pptx`, `xlsx` as `text/plain` after `pipeline/extract_text.py` (stdlib `zipfile` + `ElementTree`) writes their text to `<name>.txt` in the workspace. Any other type is stored and listed but never sent; no conversion tool is bundled.

**Selection.** `attached_materials` keeps an entry iff `gemini_mime(name)` is set and its `attach` is not `false` (default on). Size is not part of selection, so `summarize_ready` and `is_materials_only` ignore it. At the start of the summarize step, a selected non-Office entry whose on-disk `size` exceeds `MAX_GEMINI_FILE_BYTES` (10 MB) fails the step `material_too_large` before any download or upload; the auto-run fails the same way. An Office file is exempt from that check (only its extracted text is sent): the cap applies to the extracted text instead, raising the same code once extracted. An empty, corrupt or text-less file is skipped with a warning.

**Record.** After `summary.md` is written, the attached selection's names (skipped empty, unreadable or text-less files included, since the UI compares against what is attached; `[]` when none) are PUT to the database's `summary-materials`. A failed PUT is logged and the run stays successful.

**Materials-only lectures.** A lecture with no `video.mp4`, no `audio.mp3` and at least one material (`is_materials_only`) summarizes from its materials alone: `summarize_materials()` uploads them under one marker with the separate `assets/instructions/summarize_materials.md` prompt plus `LENGTH_BUDGET_SUFFIX`, and no transcript part. `_run_pipeline_unlocked` lists materials only when both `video.mp4` and `audio.mp3` are missing and passes `materials_only` to `next_step`, which then skips `audio` and `transcribe`, so the run goes summarize → pdf → drive. It is manual only: `_lecture_pending`/`scan_pending` stay video-only, so `run_all` (Run-all, `AUTO_RUN`) never picks one up. A removed `video.mp4`/`audio.mp3` is not "missing" here ([Auto-remove](#auto-remove)). `_summarize_source` is the single readiness rule, shared by `_exec_summarize` and the route's `summarize_ready`: `transcript.txt` takes the transcript path; without one, a video or audio, or no materials, is `missing_prerequisite`. A later video upload keeps the database's usual wipe; there is no marker file. A video that lands mid-summarize supersedes the materials: `_exec_summarize` re-checks `video.mp4` before `put_summary` and, if present, writes nothing and fails `missing_prerequisite` (`{file: transcript.txt, step: transcribe}`), so the run stops and the video path is what runs next; a tiny check-then-write window remains, the same as on the transcript path.

Gemini auth uses `GEMINI_API_KEY`: the SDK silently ignores OAuth `credentials=` outside Vertex AI mode. The model is `settings.gemini_model()` — `LLMClient`'s default, so summarize and the course overview cannot drift apart.

**Model fallback.** With `GEMINI_AUTO_FALLBACK` on (`settings.gemini_auto_fallback()`, off by default), `LLMClient.generate` answers a 503 (`gemini_overloaded`) by retrying once on the next entry of `GEMINI_MODELS`, wrapping round; the fallback serves that one call only, and a 429 or any other failure never falls back. If the fallback fails too (503, 429 or anything else), the original `gemini_overloaded` naming the first model is re-raised, chained from the second failure, so the user sees the regular busy error and a fallback-model quota hit never blocks the run. `upload_file` never falls back (uploads are model-independent). The client carries a 600 s HTTP timeout (`GEMINI_TIMEOUT_SECONDS`); a stalled generate or upload (client timeout, or the server's 504 `DEADLINE_EXCEEDED`, since the SDK sends the same deadline as `X-Server-Timeout`) raises `gemini_timeout {model, seconds}` at once — no retry, no fallback, no run-scoped block, and not a `CONDITION_CODE`, so it reports to Sentry. The client calls `llm_client.fallback_hook` (a `ContextVar`) with `(from, to)`; the runners set it around the worker thread via `services/notices.py`, which stores a `model_fallback` notice (per-lecture on `GET /status`, per-course on the overview status) and pings SSE.

No environment variable redirects a provider call: both SDK clients get `providers.base_url()` explicitly and Gemini gets `vertexai=False`, because the launcher passes its whole environment to every child, so a stray `GROQ_BASE_URL` / `GOOGLE_GEMINI_BASE_URL` / `GOOGLE_GENAI_USE_VERTEXAI` on a user's machine would otherwise reroute calls the key probe never checked. Proxy and CA variables stay honored.

## The database round-trip

`kind="recitation"` is forwarded to `database/` as a query string, so it injects the `Recitations/` segment. `runner._db_workspace` bridges the pure functions to it: a tempdir per step that pre-downloads named inputs and uploads named outputs on clean exit — ffmpeg, pandoc and Gemini need real filesystem paths.

Writes never create a lecture dir: on one deleted mid-run `database/` answers `lecture_not_found`, which `db_client` forwards as the step's error, so the run stops there instead of re-listing the vanished lecture. `summarize` writes with `put_summary(..., fresh=True)`, so the database drops the editor's revert snapshot and Restore original can only return this output.

## Empty-file guard

A pipeline file is never legitimately 0 bytes; when one is, the producing tool returned success with no content and raised nothing to explain it. `_require_nonempty` rejects 0-byte data at every workspace read and write, and `EMPTY_FILE_ISSUES` supplies the likely cause per filename. Without it a 0-byte file counts as "exists" for `next_step` and the run advances, surfacing a misleading downstream error instead. All six are one code, `empty_file`, carrying `{file}` only — the hints are sentence fragments and stay in the English prose.

In the frozen app, a failure whose exception chain holds an `OSError` naming `sys.executable` (an antivirus quarantining or locking the bundle mid-run) is `app_files_blocked` with no params, overriding whatever code the step wrapped it in — `services/errors.py` `own_fields`, which both runners go through; `run_all`'s `run_crashed` checks `app_files_blocked` directly. HTTP routes get the same code from the app-level middleware, which reports through `error_fields`. The OS text stays out of the params and is logged in full with its traceback, so it reaches launch.log.

Materials are the exception: they are user-supplied optional inputs with no producing step, so an empty one is skipped with a warning and the run continues on the remaining materials (or transcript-only). A materials-only summarize whose every attached material is empty has no input left, so it fails `materials_empty` (no params).

## Execution model

Outcomes of the fire-and-forget endpoints live in runner state, read via `GET /status`. Every route that reads or writes it is `async def`: the loop mutates it unlocked, so a threadpool route could see a dict change mid-iteration. `/status`'s prune of gone lectures fetches the tree off the loop and keeps any error written meanwhile. State in `pipeline/runner.py`:

- `_locks[(course, lecture, kind)]` — one `asyncio.Lock` per lecture, serializing concurrent triggers.
- `_in_flight[skey]` — all in-flight entries regardless of trigger (runner / `/pipeline` / single `/run/{step}` all populate the same map, so the frontend doesn't care which path queued them). `skey` is the string `"course||lecture||kind"` and appears verbatim in `/status`. A pipeline keeps its lecture in the map from the first step's start until it ends — success, early stop, error or exception — and each step start only rewrites `step`, so `/status` never shows it idle between steps; a lone `/run/{step}` clears it when that step ends. Under `run_all` a lecture that finishes cleanly stays in the map as `_handover` until the next step start (normally the next lecture's first) removes it in the same update that adds its own entry, so `/status` never reads empty between two lectures. Every other way out clears it at once: a step error, an exception and a block stop clear the lecture itself and notify as before, and `run_all` clears a still-held previous lecture (one notify) after an entry that started no step — nothing to do, an `audio` entry already done, a lock-held skip, a crash before the first step — and at its own end.
- `_errors[skey]` — last error as `{step, message, code, params, provider, blocked}`, survives after `_in_flight` clears; cleared when that lecture next starts a step. A summarize start from any trigger also drops every record whose `code` is in `_GEMINI_QUOTA_CODES` and carries no waiting `retry` and lifts `_summarize_block`, since it re-tests the quota; a transcribe start does the same for `_GROQ_LIMIT_CODES` and `_transcribe_block`. The sweep tests membership of those sets: a code one does not cover would strand every lecture the run stopped, whose record no later attempt would clear. `provider` is `gemini` or `groq` on those codes.
- `_summarize_block` — the `{message, params}` of the Gemini daily quota that stops `run_all` from summarizing further lectures; each one it stops gets `gemini_quota_blocked` with those same params in `_errors`, with `blocked: true`. Reset at every run's start and end, and by any summarize start.
- `_transcribe_block` — the same for Groq's rate limit: it stops `run_all` before it transcribes further lectures, each stopped one getting `groq_rate_limit_blocked` with the hit lecture's params and `blocked: true`. Reset at every run's start and end, and by any transcribe start.
- `_runner_status` — `{running, total, done, last_error}` for `run_all`; `last_error` is a crashed lecture as `{message, code, params}` (`run_crashed`), or `null`.
- `_queue` — the ordered `QueueEntry(course, lecture, kind, depth)` list `run_all` drains. In memory only: a restart empties it, and those lectures simply fall back to "has work left, nothing scheduled", which the frontend derives from the tree.

`next_step` is pure file-existence over `enabled_steps()`: the first step whose output is missing (skipping `audio`/`transcribe` when `materials_only`), a removed output counting as present. That makes every trigger resumable with no stored progress.

`db_client.notify()` fires an SSE ping on each meaningful state change (step start, error, pipeline end, a lone `run_step`'s step done, run start/complete) so the frontend reacts without polling; inside a pipeline a finished step pings only through the next step's start or the pipeline's end, and under `run_all` a finished lecture pings only through the next lecture's first step start. It is deliberately NOT fired at `run_all` start or at the end of a lecture where no step ran (beyond the one that clears a held previous lecture): with `_in_flight` still empty those pings burst, and their parallel refreshes can reorder and overwrite the fresher snapshot.

The backend also notifies once at startup, so a page still showing a step a restarted process was running refetches the now-empty `in_flight`.

`enabled_steps()` is `STEP_ORDER` minus the steps a setting switches off — only `drive`, on `DRIVE_ENABLED`. It is read per call, so `POST /config` flips the step without a restart. With Drive off a lecture is complete at `final_output()` = `summary.pdf`; completion stays pure file existence rather than gaining a marker file, and the cost is that turning Drive back on re-pends every lecture that finished while it was off.

## One queue

Every automatic trigger feeds one sequential queue rather than a task per lecture — a section download of twelve lectures would otherwise start twelve concurrent pipelines.

`enqueue(entry)` is the single point of entry. It refuses a lecture that is already queued, already in `_in_flight`, or whose lock a concurrent trigger holds, and starts `run_all` when the runner is idle — flipping `_runner_status["running"]` itself and resetting `done`, `total` (to 1) and `last_error`, so the answer to a run's first enqueue never carries the previous run's counters, because the task it creates only starts at the next await and a burst of arrivals would otherwise each start a drain.

`run_all` takes no argument: it drains `_queue` until empty, so a video arriving mid-run, or a `POST /run-all` clicked mid-run, joins that run instead of racing it (the run-all also clears the run's provider blocks, see Gemini / summarize below), and `enqueue` bumps `_runner_status["total"]` the moment a lecture joins a live run (the arrival's `notify()` pushes it); `run_all` also recomputes it from `done + len(_queue)` before each pop, so an entry a manual run pulled out drops from the count. A lecture whose lock is already held is skipped rather than awaited, unless only an auto-remove sweep's removal holds it ([Auto-remove](#auto-remove)). A manual run (`try_run_step` / `try_run_pipeline`) that starts a queued lecture pulls its entry out of `_queue`, so it runs now, alongside the drain, and the queue never re-runs it. `move_to_front` (`POST .../queue/front`) only reorders: it moves an entry to index 0, which `run_all` pops next, and notifies only when the order changed.

`depth` is how far that entry may go: `full` is `run_pipeline_for(..., honor_block=True)`, `audio` is the single `audio` step and nothing after it (skipped outright when `audio.mp3` is already there). `scan_pending` still walks the tree for lectures with `video.mp4` (on disk or removed) but no `final_output()` and returns bare `(course, lecture, kind)`; the depth is attached at each call site.

## `AUTO_RUN` — the ceiling on automatic work

`settings.auto_run()` returns `off`, `audio` or `full`; unset or unrecognised means `full`, so a typo can never silently stop every unattended run.

| Value   | A video arriving (`/video-arrived`) |
| ------- | ----------------------------------- |
| `off`   | logged and dropped                  |
| `audio` | queued at depth `audio`             |
| `full`  | queued at depth `full`              |

It never caps a run the user asked for: `POST /run-all` always enqueues at depth `full`.

The uploading service reports the arrival as a fact and holds no step names — the depth is the backend's alone.

## Auto-remove

Once a lecture reaches the user-chosen point, its intermediates are deleted through `db_client.remove_files` (the database's `POST /…/removed`). `settings.auto_remove()` is what goes: `off`, `video` (`video.mp4`) or `audio` (`video.mp4` + `audio.mp3`, cumulative); unset or unrecognised is `off`, so a typo never deletes. `settings.auto_remove_after()` is when: `pdf` (`summary.pdf` exists) or `drive` (`drive_url.txt` exists); unset or unrecognised removes nothing, and so does `drive` while `DRIVE_ENABLED` is off. Transcripts, summaries, `drive_url.txt` and materials are never removed. `removal_targets(files)` is the one rule, over a files map.

- **Every run.** `run_step` and `run_pipeline_for` end, still under the lecture's lock, with `auto_remove()`, which reads the live setting, HEADs the files and removes if the rule holds — every trigger (queue, manual pipeline, lone step) passes through one of them, so a lecture removes as soon as its PDF or Drive upload lands, and one in flight when the user changes the rule applies the rule current when it finishes. A failure, `file_locked` (open elsewhere) included, is a warning and never the run's outcome.
- **Apply.** `apply_auto_remove()` (`POST /auto-remove/apply`) sweeps the tree, archived courses included like `scan_pending`. A lecture whose lock is held is mid-run and counted `deferred`, since its own end-of-run call covers it. Otherwise the sweep takes the free lock without yielding and, for its one removal call, adds the lecture to `_removing`. `_busy()` — the check `enqueue`, `try_run_*` and `run_all`'s skip use — ignores a lock held that way, so a trigger arriving meanwhile is never refused and `run_all` never skips a queued lecture: each waits on the lock instead. `_claim()` drops the lecture from `_removing` as the first such trigger takes it, so a second still answers `busy`. Holding the lock means no step is ever reading a file the sweep deletes.
- **Removed counts as present.** The tree's `removed` is derived from the files, not recorded: an absent `video.mp4` is removed when `audio.mp3` or `transcript.txt` exists, an absent `audio.mp3` when `transcript.txt` does, so a file deleted in File Explorer counts the same as an auto-removed one. `_mark_removed` flags those names on a files map and `_present` reads them as done, so `next_step` resumes such a lecture at `drive` rather than `audio`, `_lecture_pending` keeps it pending until its final output exists, and `is_materials_only` never mistakes it for a materials-only lecture. `_fetch_files` reads the tree only when `audio.mp3` is absent and `transcript.txt` exists; otherwise `removed` either cannot name `audio.mp3` or is empty.

## Rate limits

No step sleeps inside a run: a failed step records the error and releases the lecture's lock. A transient Gemini failure is re-run later by [Auto retry](#auto-retry); every other one waits for the user.

**Groq / transcribe.** `transcribe_audio` raises `TranscribeRateLimitError` (a `CodedError`, `groq_rate_limited`, params `{limit, used, requested, retry_after_seconds}` parsed from Groq's prose message) and leaves `transcript.partial.txt` + `.meta.json` on disk. The executor returns it as an error flagged `groq_limit`, which sets the run-scoped `_transcribe_block`: every later lecture in the same `run_all` stops before transcribing, carrying the same record so it reads as blocked rather than pending. A manual `/run/transcribe` or `/pipeline` trigger still runs and clears the block. The next transcribe continues from the partial.

Resume validates the meta against `audio.mp3`'s size AND mtime. Re-downloading audio gives it a fresh mtime, so the transcribe executor restores the mtime recorded in the partial meta — otherwise every resume silently falls back to a full restart.

**Gemini / summarize.** `LLMClient.generate` parses a 429 body into `GeminiRateLimitError` (`{quota_id, quota_value, model, is_daily}`) instead of leaking the SDK's JSON blob. Those same facts ride the wire as the `gemini_quota_exhausted` params `{scope, model, limit, tier}` (`quota_params`), so the sentence is a renderer's to build rather than the backend's. The 429's `retryDelay` is never parsed — the quota kind says everything actionable, and a daily quota's `retryDelay` lies (claims 59s, actually resets at midnight Pacific).

- Per-minute quota → plain `gemini_quota_exhausted` error (`scope: per_minute`) that stops only its lecture; no run-wide block.
- Daily quota (`quotaId` containing `PerDay`, or anything unrecognised — the safe default) → plain error. It also sets the run-scoped `_summarize_block` so every later lecture in the same `run_all` stops at `transcript.txt` without calling Gemini, carrying the same quota record so it reads as blocked rather than pending. Audio+transcribe are Groq (separate quota) so the queue still gets fully transcribed, and a later run resumes each lecture at summarize.

Manual `/run/summarize` and `/pipeline` triggers ignore both blocks, and `POST /run-all` clears them before it enqueues (a live run included) — the user may have swapped keys. An automatic arrival never clears them.

## Auto retry

A Gemini step that fails transiently re-runs itself on a fixed schedule, with no model rotation (`GEMINI_AUTO_FALLBACK` still applies inside each run). `services/auto_retry.py` holds the rules; the timers live in `pipeline/runner.py` (`_retries`, `_attempts`) and `course/runner.py` (overview), memory only, so a restart drops them and the step reads as a plain failure.

- **What retries.** The `summarize`, `intuition` and `solution` steps and the overview `analyze` phase, on `gemini_overloaded`, `gemini_timeout`, `gemini_unreachable` (a network failure with no HTTP answer) and `gemini_quota_exhausted` with `scope: per_minute`. Never a daily quota, `missing_api_key`, `api_key_rejected`, `material_too_large`, empty input or any wrapped failure. A `gemini_quota_blocked` record never reaches a step, so it is never retried. `llm_client`'s coded errors pass through the assignment and overview wrappers unchanged, so the classifier reads the real code.
- **Schedule.** `AUTO_RETRY_COUNT` re-runs after the original failure (default 3, clamp 1–10), `AUTO_RETRY_MINUTES` apart (default 10, clamp 1–120), no backoff; `AUTO_RETRY` off (default on) schedules nothing. A changed count or delay applies to the next retry armed, not one already waiting. After the last failure the error stays as before.
- **State.** One `loop.call_later` timer per skey (overview: per course + extractor). The waiting retry rides the error record as `retry {attempt, of, at}`; `_attempts` carries the count across the runs the retries start and is cleared by a success, a non-transient failure or a manual run.
- **Replay.** The record keeps the original request. A lone step (`/run/{step}`, assignment step) re-runs through `try_run_step` / `try_run_assignment_step`; a pipeline, queue, Run-all or `AUTO_RUN` run re-enqueues the lecture at depth `full` and resumes at the failed step through `next_step`; the overview re-runs that extractor with `from_phase=analyze`. A waiting retry holds neither the lock nor the queue. If the lecture is busy when the timer fires, or its error record is gone, the retry is dropped and the plain error stays.
- **Dropped** by the cancel routes ([API.md](API.md)), any manual run of that lecture or step (a Run-all or arrival enqueue included), the rename/delete prune that drops the error, and `POST /config {auto_retry: false}`. Each change pings SSE; the client computes the countdown from `at`.

## Assignments

An assignment's Intuition Guide and Full Solution are runner steps under `kind="assignment"` (the assignment name in the `lecture` slot, skey `{course}||{assignment}||assignment`), served by `POST /courses/{c}/assignments/{a}/run/{step}` ([API.md](API.md)). They reuse the per-key lock, `_in_flight`, `_errors` and `/status`, with these differences:

- Steps: `intuition` / `solution` = inputs → Gemini → `{doc}.md` (written `fresh`, dropping edits and the restore snapshot) → the PDF render in the same run; `intuition_pdf` / `solution_pdf` only re-render (`fresh` drops the old PDF first). The PDF, warning and build-tex markers go through the database's `.generated/` routes with the lecture `pdf` step's keep/drop rules. The two docs are independent: neither is an input to the other.
- Inputs, in this order: the assignment's files whose switch is on and whose type `gemini_mime` supports (the 10 MB cap, `material_too_large`; Office files go as extracted text and the cap applies to that text), then the `summary.md` of each selected lecture/recitation as one inline `<lecture kind title>` text part (a vanished or summary-less one is skipped with a log line), then the prompt (`assets/instructions/assignment_{doc}.md`). None left is `assignment_inputs_empty`; a Gemini failure is `assignment_generation_failed {detail}`.
- Manual only: `try_run_assignment_step` never touches `_queue`, and run-all and `AUTO_RUN` never start one. `auto_remove` is skipped.
- A transient Gemini failure retries like any step ([Auto retry](#auto-retry)).
- A daily quota records `gemini_quota_exhausted` like any step but never sets `_summarize_block` and never sweeps other records: no run-all depends on it.
- `prune_stale_errors` keeps an assignment's error while the assignment is in the tree.

## Timing

`timing/` logs `(operation, file_size_bytes, duration_seconds)` to a SQLite db via the `@timed_pipeline` decorator; `get_stats` returns a linear-regression ETA. A list of paths as the first argument records their summed size, an int as is (an assignment doc's summed input bytes, in `assignment_intuition` / `assignment_solution`; its PDF render uses `pdf`); the materials-only summarize records under its own `summarize_materials` bucket so materials-only runs never skew the transcript `summarize` ETA. See [timing/README.md](../timing/README.md) for queries and the outlier-cleaning scripts.

The db sits at `runtime.state_path("timing.db")`, outside the `backend/` tree `--reload` watches, so the runner's constant writes never restart the dev server. `timing/__init__.py` owns that path and `init_db()` creates the directory — `state_path` itself only joins.

## Logging

`backend_main.py` calls `setup_logging()` at import; the format, the dropped access lines and why it owns `uvicorn.access` are [lib/logging](../../lib/logging/CLAUDE.md)'s. The silenced `httpx` INFO line would otherwise print once per Groq chunk.
