# HTTP API

All endpoints are in `backend_main.py`. A mutating one never returns its result — it schedules a task and the frontend reads the outcome from a status endpoint.

CORS allows `http://localhost:5173` and `app://bundle` (the packaged frontend), plus any `http://localhost:<port>` when `FASTSTUDY_SECRET` is unset (dev), via `runtime.cors_origins`.

## Failures

A refused request answers `{"error": "<message>", "code": "<snake_case>", "params": {...}}` with a non-2xx status, the same shape `database/` uses (`_error` + `failure` in `backend_main.py`) — never a 200 envelope, so the frontend surfaces every failure through the one error its HTTP layer throws. `error` is the developer-facing English; `code` and its flat `params` are what a client renders from ([docs/ERROR-CODES.md](../../docs/ERROR-CODES.md)). A bad query value or request body is FastAPI's own `422 {"detail": [...]}`; `kind` is a `Literal`, so it is validated there rather than in a handler.

An exception that escapes a route answers the same body from an app-level middleware — `storage_unavailable` when a call to `database/` failed without the route handling it, or the code the exception names itself (`services/errors.py` `own_fields`: `app_files_blocked` when the chain shows the frozen executable became unreadable, see PIPELINE.md, or a `CodedError`'s own code), else `internal_error`. It sits inside CORS, because a 500 raised outside it reaches the browser as a network error rather than a body.

The middleware never translates a peer code it wasn't given, so a refusal the user can act on is answered by the route that can receive it: it catches `DbClientError`, and when the code is in `_USER_ACTIONABLE_STORAGE_CODES` (today `data_root_not_configured`) re-emits the peer's own code and params as a 409 — every other code re-raises to the backstop. `POST /courses/{course}/overview/generate`, `POST /run-all` and `POST /auto-remove/apply` read the tree and do this; a new route that reads through `db_client` and can be refused by name joins them.

## The launch secret

When `FASTSTUDY_SECRET` is set, every request but `GET /health` must carry it; the header, the `secret` query parameter, the 401 shapes and the ordering against CORS are [lib/runtime](../../lib/runtime/CLAUDE.md)'s (`runtime.install_secret_check`). `services/db_client.py` sends the same header on every call to `database/`.

## Health

`GET /health`
`{"status": "ok"}` — liveness only, answered without waiting on anything; everything else sits on routes that can be refused.

`GET /tools`
`{"tools": {name: "ok" | {code, state, params}}}` for `ffmpeg`, `pandoc` and `tectonic` — the record is [lib/tools](../../lib/tools/CLAUDE.md)'s, relayed unchanged. The probe runs once per process on a background thread started at import, so it never delays startup; a call before it settles waits for it. The frontend calls it once after the window opens.

## Materials

`GET /materials/supported`
`{"extensions": ["pdf", "png", …]}` — the file types a summary can send to Gemini (`pipeline/material_types.py`); the rest are stored but never sent.

## Per-lecture

`POST /courses/{course}/lectures/{lecture}/run/{step}?kind={lecture|recitation}[&fresh=true]`
`step ∈ {audio, transcribe, summarize, pdf, drive}`, `kind` defaults to `lecture`. `fresh=true` (pdf only; other steps ignore it) deletes the old `summary.pdf` through the database once the run holds the lecture's lock, before the render; a failed delete is the pdf step's error with the database's own code (`file_locked` for a PDF another program holds open) and nothing renders. A `busy` answer touches no file.
Unknown step → 404. Validates that the step's prerequisite file exists (`_STEP_CONFIG`; for `summarize`, `runner.summarize_ready`: `transcript.txt`, or no `video.mp4`, no `audio.mp3` and at least one attached, supported material), answering 409 `"<file> is required — run <previous step> first"` otherwise; a step a setting has switched off is 409 `"<step> is disabled in settings"`. On success → `{"status": "started"|"busy"}`.

`POST /courses/{course}/assignments/{assignment}/run/{step}[?fresh=true]`
`step ∈ {intuition, solution, intuition_pdf, solution_pdf}`; an unknown step is 404 `unknown_step`. A `*_pdf` step whose `{doc}.md` is not in the assignment's tree entry is 409 `missing_prerequisite {file: "{doc}.md", step: "{doc}"}`; for `*_pdf` only, a vanished assignment is 404 `lecture_not_found` (`intuition`/`solution` answer `started` and the run records the error). `fresh=true` applies to `*_pdf` only (drops the old PDF before the render). → `{"status": "started"|"busy"}`. Manual only: it never joins the runner queue ([PIPELINE.md](PIPELINE.md#assignments)).

`POST /courses/{course}/lectures/{lecture}/pipeline?kind=...`
Advances the lecture through every remaining step. → `{"status": "started"|"busy"}`. Both this and `run/{step}` pull a lecture waiting in the runner queue out of it when they start it.

`POST /courses/{course}/lectures/{lecture}/queue/front?kind=...`
Makes a lecture waiting in the runner queue the next one it takes, keeping its `depth`; it only reorders, so nothing starts and the run's total is unchanged. → `{"status": "moved"|"not_queued"}` — `moved` also when it was already first, `not_queued` when it is not in `queue` (in flight included). A real move pushes one SSE notify.

`POST /courses/{course}/lectures/{lecture}/video-arrived?kind=...`
A new `video.mp4` landed on disk, reported by whichever service uploaded it — the downloader helper server or the frontend — once the upload succeeded. A fact, not a command: `AUTO_RUN` decides the depth and the lecture is queued rather than run inline. → `{"status": "queued"|"busy"|"off"}` — `off` when `AUTO_RUN` forbids automatic work, `busy` when the lecture is already queued, in flight, or owned by another trigger.

`POST /run-all`
Scans for pending lectures and queues them at depth `full`, whatever `AUTO_RUN` caps automatic work at — the user asked for this one explicitly. A live run is joined, not refused: the pending lectures not already queued or in flight are enqueued into it, and its Gemini/Groq provider blocks are cleared so they get a fresh try. → `{"status": "started"|"empty_queue"|"all_in_flight"}`.
`all_in_flight` means every pending lecture is already owned by a concurrent trigger — the run would have skipped them all, so the UI can say so instead of appearing to do nothing.

`POST /auto-remove/apply`
No body. Applies the live `AUTO_REMOVE` rule to every existing lecture and recitation, archived courses included, and answers once done → `{"removed": n, "locked": n, "deferred": n, "failed": n}`, each a count of lectures: files removed, skipped because one is open elsewhere (`423 file_locked` from the database), deferred because mid-run (its own end-of-run hook applies the rule), or failed otherwise. A lecture with nothing to remove is in no count; with the rule off all four are `0` ([PIPELINE.md](PIPELINE.md#auto-remove)).

`GET /status`
`{runner: {running, total, done, last_error}, in_flight: [...], queue: [...], errors: {skey: {step, message, code, params, provider, blocked, retry?}}, overview_running: [course, ...], notices: [...]}`. An error is the last failed step of that lecture; each request answers from the state as of the request, then starts a single-flight prune (a join queues one rerun) of errors whose lecture is gone (a rename or delete never reaches the runner; a prune that removed one pings SSE, so the client refetches), so a renamed or deleted lecture loses its error, while one that exists keeps it whatever files it has; `code` names the failure and `params` holds its named values, with `provider` `"gemini"` on the two Gemini quota codes, `"groq"` on `groq_rate_limited` / `groq_rate_limit_blocked` and `null` elsewhere. `last_error` is a run crash, `{message, code, params}` or `null`. A lecture a run stopped before summarize because an earlier one hit that quota carries `gemini_quota_blocked`, and one stopped before transcribe on a Groq rate limit carries `groq_rate_limit_blocked`, each with the same params and `blocked: true`; every other record, the one that hit the quota included, has `blocked: false`. `retry` is present only while an auto retry waits: `{attempt, of, at}` with `at` an absolute ISO UTC time, `attempt` counting retries (the first wait reads 1 of N); it vanishes when the retry fires or is cancelled, leaving the error ([PIPELINE.md](PIPELINE.md#auto-retry)). `queue` lists what the runner has left to take, in the order it will take them, each `{course, lecture, kind, depth}` with `depth ∈ {full, audio}`. `overview_running` lists, sorted, the courses with an overview slug pending or mid-chain, so the UI can lock a rename that would fail it with `course_not_found`. `notices` lists the live run notices, oldest first, each `{id, code, params, course, lecture, kind}` — today only `code: "model_fallback"`, `params: {from, to}` (a Gemini 503 retried on the next model, see [PIPELINE.md](PIPELINE.md)); `id` is unique and increasing, across backend restarts too (seeded from the clock), so a client toasts each once, and a notice is dropped 120 s after it is raised (no other clearing). Each one pushes an SSE notify. Cheap; the UI refetches it on each SSE notify. An assignment run appears in `in_flight` and `errors` as `kind: "assignment"` with `lecture` the assignment name and `step` the step id (skey `{course}||{assignment}||assignment`); its error lives while the assignment exists.

`DELETE /retry?course=&lecture=&kind=lecture|recitation|assignment`
Cancels the waiting auto retry of one lecture step (`lecture` carries the assignment name for `kind=assignment`); the error stays, only the `retry` field and the timer go. → `{"cancelled": bool}` — `false` when none waited. Pushes one SSE notify when it cancelled.

`DELETE /courses/{course}/overview/retry?extractor={slug}`
The same for an overview extractor's waiting analyze retry. → `{"cancelled": bool}`.

## Timing

`operation` on record is restricted to an allowlist: the pipeline steps (`STEP_ORDER`), `assignment_intuition` / `assignment_solution` and downloader's `OPERATIONS`.

`GET /timing/{operation}?file_size_bytes=N`
Regression ETA from past runs, or `{"message": "not-enough-data"}`.

`POST /timing`
body `{"operation": str, "file_size_bytes": int, "duration_seconds": float}`
Records one sample. → `{"status": "ok"}`, or 400 for a blank/unknown operation or a non-positive size/duration (a non-positive sample would skew every later estimate; an unknown operation would log a warning and silently create a dead bucket nothing queries). Server-to-server; not reachable from an arbitrary browser page, since CORS only allows the frontend's own origins (any localhost port in dev).

## Course overview

`POST /courses/{course}/overview/generate?extractors=<csv>&from_phase=<id>&skip_existing=<bool>`
`extractors` is an optional CSV of extractor **slugs** (default: all). `from_phase` omitted → each extractor's full chain; an unknown value, like an unknown extractor slug, is 400. Unknown course → 404. On success → `{"status": "started"|"busy"}`. Semantics of the run, the phases, and both flags are in [OVERVIEW.md](OVERVIEW.md).

There is deliberately no per-phase endpoint — the frontend never sequences phases itself, mirroring `/run-all`.

`GET /courses/{course}/overview/status`
`{"running": bool, "extractors": {slug: {"status": "pending"|"running"|"done"|"skipped"|"error", "phase"?, "message"?, "code"?, "params"?, "started_at"?, "retry"?}}}` (snake_case on the wire). `code` and `params` sit beside `message` on every skipped or errored entry, as everywhere else. `notices` is the same list scoped to this course's overview runs, each `{id, code, params}` with the same expiry. `retry` (`{attempt, of, at}`, as on `/status`) sits on an errored entry whose analyze phase failed transiently on Gemini while an auto retry waits. `started_at` is an ISO UTC stamp of when that slug's phase chain began — one per chain, so the UI can clock a running branch. Never-run course → `{"running": false, "extractors": {}, "notices": []}`.

`GET /overview/extractors`
Static `{"extractors": [{"slug", "title", "phases"}]}` in declaration order. `phases` lets the UI tell immediate extractors apart from pattern ones.

## Config

The backend-owned settings: both API keys, the Gemini model, the Drive toggle, the Drive root folder, the `AUTO_RUN` ceiling, the `AUTO_REMOVE` / `AUTO_REMOVE_AFTER` rule, plus the error-reports switch. `database/` owns `DATA_ROOT` and the persistent store; these endpoints only move values in and out of the running process.

`POST /config`
body: any subset of `{gemini_api_key, groq_api_key, gemini_model, gemini_auto_fallback, drive_enabled, gdrive_root_folder, auto_run, auto_remove, auto_remove_after, auto_retry, auto_retry_count, auto_retry_minutes, error_reports}`. Writes each field to its environment variable, so the change applies with no restart; omitted fields are untouched. `error_reports` (bool, sent by the launcher when the user flips the switch) is no env var: it sets the Sentry transport gate, so sending stops or starts from that call on. `auto_retry` (bool), `auto_retry_count` and `auto_retry_minutes` (ints) are read through clamping accessors (defaults on, 3, 10; ranges 1–10 and 1–120); `auto_retry: false` also drops every pending retry, lecture and overview. → `{"status": "ok", "applied": [field names]}` — a key value is never logged and never echoed back.

`GET /config/options`
`{"providers": [{"id", "display_name", "key_prefix", "console_url"}], "gemini_models": [...]}` from `services/providers.py` and `services/settings.py`, so the settings screens hold no second copy of either list. Each provider's base URL stays server-side.

`GET /config/drive/status`
`{"connected": bool, "pending": bool, "consent_needed": bool}` — a stored Drive token, a consent flow waiting on the user, and whether a pipeline step gave up for want of a token. The last one is process state, not an event, so a queue of lectures with no token leaves the UI one thing to render; it clears when a token lands. A landed token, a flow that failed or timed out, and a disconnect each push on the database SSE channel, so no screen polls this; the caller of `connect` learns `pending` from its own response.

`POST /config/drive/connect`
Starts the Google consent flow and returns `{"auth_url": str}` at once, without waiting for the user; the backend opens the browser itself, so the URL is only the "didn't open?" fallback. A second call while one flow is pending returns the same URL rather than starting a rival flow. Missing `credentials.json` → 500, since it is a packaging fault rather than the caller's. The URL is never printed to stdout — the launcher parses this process's stdout for its port.

`POST /config/drive/disconnect`
Deletes the stored token → `{"status": "ok"}`. Already disconnected is success.

`POST /config/probe-key`
body `{"provider": "groq"|"gemini", "key": str}` → `{"result": "valid"|"rejected"|"unverified"}`, or 400 for an unknown provider. The key is authenticated against the provider's list-models endpoint (zero tokens, no per-model quota). Only an explicit 401/403, or a 400 whose body names `API_KEY_INVALID` (Gemini's answer to a bad key), is `rejected`; every other status, a timeout or an unreachable host is `unverified` — an offline user must never be told a good key is bad. `key_prefix` from `/config/options` is an offline hint for the UI and is not enforced here.
