# HTTP API

All endpoints are defined in `main.py`, which stays thin route glue — validation helpers and boundary parsing live in the runners.

Every mutating endpoint is fire-and-forget: it schedules a background asyncio task and returns immediately. Results never come back in the HTTP response; the frontend reads them from the status endpoints.

CORS is open to `http://localhost:5173` only.

## Per-lecture

`POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}`
`step ∈ {audio, transcribe, summarize, pdf, drive}`, `kind` defaults to `lecture`.
Validates that the step's prerequisite file exists (`_STEP_CONFIG`), returning `{"status": "error", "message": "<file> is required — run <previous step> first"}` otherwise. A step a setting has switched off → `{"status": "error", "message": "<step> is disabled in settings"}`. On success → `{"status": "started"|"busy"}`.

`POST /courses/{course}/lectures/{lecture}/pipeline?kind=...`
Advances the lecture through every remaining step. → `{"status": "started"|"busy"}`.

`POST /run-all`
Scans for pending lectures and runs the queue. → `{"status": "started"|"already_running"|"empty_queue"|"all_in_flight"}`.
`all_in_flight` means every pending lecture is already owned by a concurrent trigger — run_all would have skipped them all, so the UI can say so instead of appearing to do nothing.

`GET /status`
`{runner: {running, total, done, last_error}, in_flight: [...], errors: {skey: message}}`. Cheap; the UI refetches it on each SSE notify.

## Timing

`operation` on record is restricted to an allowlist: the pipeline steps (`STEP_ORDER`) plus downloader's `OPERATIONS`.

`GET /timing/{operation}?file_size_bytes=N`
Regression ETA from past runs, or `{"message": "not-enough-data"}`.

`POST /timing`
body `{"operation": str, "file_size_bytes": int, "duration_seconds": float}`
Records one sample. → `{"status": "ok"}`, or `{"status": "error", "message": ...}` for a blank/unknown operation or a non-positive size/duration (a non-positive sample would skew every later estimate; an unknown operation would log a warning and silently create a dead bucket nothing queries). Server-to-server; not reachable from the browser, since CORS only allows the frontend origin.

## Course overview

`POST /courses/{course}/overview/generate?extractors=<csv>&from_phase=<id>&skip_existing=<bool>`
`extractors` is an optional CSV of extractor **slugs** (default: all). `from_phase` omitted → each extractor's full chain; an unknown value → `{"status": "error"}`. → `{"status": "started"|"busy"}`, or an error envelope for an unknown extractor/course. Semantics of the run, the phases, and both flags are in `OVERVIEW.md`.

There is deliberately no per-phase endpoint — the frontend never sequences phases itself, mirroring `/run-all`.

`GET /courses/{course}/overview/status`
`{"running": bool, "extractors": {slug: {"status": "pending"|"running"|"done"|"skipped"|"error", "phase"?, "message"?}}}` (snake_case on the wire). Never-run course → `{"running": false, "extractors": {}}`.

`GET /overview/extractors`
Static `{"extractors": [{"slug", "title", "phases"}]}` in declaration order. `phases` lets the UI tell immediate extractors apart from pattern ones.

## Config

The backend-owned settings: both API keys, the Gemini model, the Drive toggle and the Drive root folder. `database/` owns `DATA_ROOT` and the persistent store; these endpoints only move values in and out of the running process.

`POST /config`
body: any subset of `{gemini_api_key, groq_api_key, gemini_model, drive_enabled, gdrive_root_folder}`. Writes each field to its environment variable, so the change applies with no restart; omitted fields are untouched. → `{"status": "ok", "applied": [field names]}` — a key value is never logged and never echoed back.

`GET /config/options`
`{"providers": [{"id", "display_name", "key_prefix", "console_url"}], "gemini_models": [...]}` from `services/providers.py` and `services/settings.py`, so the settings screens hold no second copy of either list. Each provider's probe URL stays server-side.

`POST /config/probe-key`
body `{"provider": "groq"|"gemini", "key": str}` → `{"result": "valid"|"rejected"|"unverified"}`, or an error envelope for an unknown provider. The key is authenticated against the provider's list-models endpoint (zero tokens, no per-model quota). Only an explicit 401/403 is `rejected`; every other status, a timeout or an unreachable host is `unverified` — an offline user must never be told a good key is bad. `key_prefix` from `/config/options` is an offline hint for the UI and is not enforced here.
