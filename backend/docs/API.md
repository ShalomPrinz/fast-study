# HTTP API

All endpoints are in `backend_main.py`. A mutating one never returns its result — it schedules a task and the frontend reads the outcome from a status endpoint.

CORS is open to the frontend's two origins only: `http://localhost:5173` in dev and `app://bundle` in the packaged app.

## Failures

A refused request answers `{"error": "<message>", "code": "<snake_case>", "params": {...}}` with a non-2xx status, the same shape `database/` uses (`_error` + `failure` in `backend_main.py`) — never a 200 envelope, so the frontend surfaces every failure through the one error its HTTP layer throws. `error` is the developer-facing English; `code` and its flat `params` are what a client renders from ([docs/ERROR-CODES.md](../../docs/ERROR-CODES.md)). A bad query value or request body is FastAPI's own `422 {"detail": [...]}`; `kind` is a `Literal`, so it is validated there rather than in a handler.

An exception that escapes a route answers the same body from an app-level middleware — `storage_unavailable` when `database/` is unreachable or refused, `internal_error` otherwise. It sits inside CORS, because a 500 raised outside it reaches the browser as a network error rather than a body.

## The launch secret

When `FASTSTUDY_SECRET` is set, every request but `GET /health` must carry it; the header, the `secret` query parameter, the 401 shapes and the ordering against CORS are [lib/runtime](../../lib/runtime/CLAUDE.md)'s (`runtime.install_secret_check`). `services/db_client.py` sends the same header on every call to `database/`.

## Health

`GET /health`
`{"status": "ok", "tools": {...}}` — liveness plus the boot-time probe of `ffmpeg`, `pandoc` and `tectonic` ([lib/tools](../../lib/tools/CLAUDE.md)), so the launcher's boot screen can render a missing binary. Nothing else on purpose: paths, config and key-set flags stay on routes that can be refused.

## Per-lecture

`POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}`
`step ∈ {audio, transcribe, summarize, pdf, drive}`, `kind` defaults to `lecture`.
Unknown step → 404. Validates that the step's prerequisite file exists (`_STEP_CONFIG`), answering 409 `"<file> is required — run <previous step> first"` otherwise; a step a setting has switched off is 409 `"<step> is disabled in settings"`. On success → `{"status": "started"|"busy"}`.

`POST /courses/{course}/lectures/{lecture}/pipeline?kind=...`
Advances the lecture through every remaining step. → `{"status": "started"|"busy"}`. Both this and `run/{step}` pull a lecture waiting in the runner queue out of it when they start it.

`POST /courses/{course}/lectures/{lecture}/video-arrived?kind=...`
A new `video.mp4` landed on disk, reported by whichever service uploaded it — the downloader helper server or the frontend — once the upload succeeded. A fact, not a command: `AUTO_RUN` decides the depth and the lecture is queued rather than run inline. → `{"status": "queued"|"busy"|"off"}` — `off` when `AUTO_RUN` forbids automatic work, `busy` when the lecture is already queued, in flight, or owned by another trigger.

`POST /run-all`
Scans for pending lectures and queues them at depth `full`, whatever `AUTO_RUN` caps automatic work at — the user asked for this one explicitly. → `{"status": "started"|"already_running"|"empty_queue"|"all_in_flight"}`.
`all_in_flight` means every pending lecture is already owned by a concurrent trigger — the run would have skipped them all, so the UI can say so instead of appearing to do nothing.

`GET /status`
`{runner: {running, total, done, last_error}, in_flight: [...], queue: [...], errors: {skey: {step, message, code, params, provider, blocked}}}`. An error is the last failed step of that lecture; `code` names the failure and `params` holds its named values, with `provider` `"gemini"` on the two Gemini quota codes and `null` elsewhere. `last_error` is a run crash, `{message, code, params}` or `null`. A lecture a run stopped before summarize because an earlier one hit that quota carries `gemini_quota_blocked` with the same params and `blocked: true`; every other record, the one that hit the quota included, has `blocked: false`. `queue` lists what the runner has left to take, in the order it will take them, each `{course, lecture, kind, depth}` with `depth ∈ {full, audio}`. Cheap; the UI refetches it on each SSE notify.

## Timing

`operation` on record is restricted to an allowlist: the pipeline steps (`STEP_ORDER`) plus downloader's `OPERATIONS`.

`GET /timing/{operation}?file_size_bytes=N`
Regression ETA from past runs, or `{"message": "not-enough-data"}`.

`POST /timing`
body `{"operation": str, "file_size_bytes": int, "duration_seconds": float}`
Records one sample. → `{"status": "ok"}`, or 400 for a blank/unknown operation or a non-positive size/duration (a non-positive sample would skew every later estimate; an unknown operation would log a warning and silently create a dead bucket nothing queries). Server-to-server; not reachable from an arbitrary browser page, since CORS only allows the frontend's own origins.

## Course overview

`POST /courses/{course}/overview/generate?extractors=<csv>&from_phase=<id>&skip_existing=<bool>`
`extractors` is an optional CSV of extractor **slugs** (default: all). `from_phase` omitted → each extractor's full chain; an unknown value, like an unknown extractor slug, is 400. Unknown course → 404. On success → `{"status": "started"|"busy"}`. Semantics of the run, the phases, and both flags are in [OVERVIEW.md](OVERVIEW.md).

There is deliberately no per-phase endpoint — the frontend never sequences phases itself, mirroring `/run-all`.

`GET /courses/{course}/overview/status`
`{"running": bool, "extractors": {slug: {"status": "pending"|"running"|"done"|"skipped"|"error", "phase"?, "message"?, "code"?, "params"?, "started_at"?}}}` (snake_case on the wire). `code` and `params` sit beside `message` on every skipped or errored entry, as everywhere else. `started_at` is an ISO UTC stamp of when that slug's phase chain began — one per chain, so the UI can clock a running branch. Never-run course → `{"running": false, "extractors": {}}`.

`GET /overview/extractors`
Static `{"extractors": [{"slug", "title", "phases"}]}` in declaration order. `phases` lets the UI tell immediate extractors apart from pattern ones.

## Config

The backend-owned settings: both API keys, the Gemini model, the Drive toggle, the Drive root folder, the `AUTO_RUN` ceiling and the nightly cron's on/off switch and hour. `database/` owns `DATA_ROOT` and the persistent store; these endpoints only move values in and out of the running process.

`POST /config`
body: any subset of `{gemini_api_key, groq_api_key, gemini_model, drive_enabled, gdrive_root_folder, auto_run, nightly_run, nightly_hour}`. Writes each field to its environment variable, so the change applies with no restart; omitted fields are untouched. The nightly cron is then re-applied unconditionally — an out-of-range `nightly_hour` is clamped to 03:00 there, never rejected here ([PIPELINE.md](PIPELINE.md)). → `{"status": "ok", "applied": [field names]}` — a key value is never logged and never echoed back.

`GET /config/options`
`{"providers": [{"id", "display_name", "key_prefix", "console_url"}], "gemini_models": [...]}` from `services/providers.py` and `services/settings.py`, so the settings screens hold no second copy of either list. Each provider's base URL stays server-side.

`GET /config/drive/status`
`{"connected": bool, "pending": bool, "consent_needed": bool}` — a stored Drive token, a consent flow waiting on the user, and whether a pipeline step gave up for want of a token. The last one is process state, not an event, so a queue of lectures with no token leaves the UI one thing to render; it clears when a token lands. A landed token, a flow that failed or timed out, and a disconnect each push on the database SSE channel, so no screen polls this; the caller of `connect` learns `pending` from its own response.

`POST /config/drive/connect`
Starts the Google consent flow and returns `{"auth_url": str}` at once, without waiting for the user; the backend opens the browser itself, so the URL is only the "didn't open?" fallback. A second call while one flow is pending returns the same URL rather than starting a rival flow. Missing `credentials.json` → 500, since it is a packaging fault rather than the caller's. The URL is never printed to stdout — the launcher parses this process's stdout for its port.

`POST /config/drive/disconnect`
Deletes the stored token → `{"status": "ok"}`. Already disconnected is success.

`POST /config/probe-key`
body `{"provider": "groq"|"gemini", "key": str}` → `{"result": "valid"|"rejected"|"unverified"}`, or 400 for an unknown provider. The key is authenticated against the provider's list-models endpoint (zero tokens, no per-model quota). Only an explicit 401/403 is `rejected`; every other status, a timeout or an unreachable host is `unverified` — an offline user must never be told a good key is bad. `key_prefix` from `/config/options` is an offline hint for the UI and is not enforced here.
