# HTTP API

All endpoints are defined in `main.py`, which stays thin route glue — validation helpers and boundary parsing live in the runners.

Every mutating endpoint is fire-and-forget: it schedules a background asyncio task and returns immediately. Results never come back in the HTTP response; the frontend reads them from the status endpoints.

CORS is open to `http://localhost:5173` only.

## Per-lecture

`POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}`
`step ∈ {audio, transcribe, summarize, pdf, drive}`, `kind` defaults to `lecture`.
Validates that the step's prerequisite file exists (`_STEP_CONFIG`), returning `{"status": "error", "message": "<file> is required — run <previous step> first"}` otherwise. On success → `{"status": "started"|"busy"}`.

`POST /courses/{course}/lectures/{lecture}/pipeline?kind=...`
Advances the lecture through every remaining step. → `{"status": "started"|"busy"}`.

`POST /run-all`
Scans for pending lectures and runs the queue. → `{"status": "started"|"already_running"|"empty_queue"|"all_in_flight"}`.
`all_in_flight` means every pending lecture is already owned by a concurrent trigger — run_all would have skipped them all, so the UI can say so instead of appearing to do nothing.

`GET /status`
`{runner: {running, total, done, last_error}, in_flight: [...], errors: {skey: message}}`. Cheap; polled by the UI.

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
