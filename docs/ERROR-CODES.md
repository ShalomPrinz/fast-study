# Error codes

Every failure a service reports carries a stable machine `code` and a flat `params` object beside its
English prose. The frontend owns every sentence a user reads; the services own the codes.

## Why the wording lives in the frontend

There is one client, it already ships Lingui catalogs in Hebrew and English, and the language is a
`localStorage` choice that reaches no service (`frontend/docs/I18N.md`). Pushing a locale into four
services would add contract surface — a locale header on every request, four catalogs to keep in
step, and a second place to look when a sentence reads wrong — to produce strings only that one
client renders. So the split follows RFC 9457's `type` vs `detail` and Google's AIP-193: the service
states _which_ failure happened in a machine-readable way, the client states it in words.

A service's prose stays, unchanged and English. It is the developer-facing description and the
fallback an unknown code renders.

## The wire

Failures travel on these channels, and every one carries the same two fields beside the prose it
already had.

| Channel         | Shape                                                                      | Produced by                                                  |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| HTTP body       | `{error, code, params}` on every non-2xx                                   | all four services                                            |
| Pipeline error  | `{step, message, code, params, provider, blocked}` per lecture on `/status` | `backend/pipeline/runner.py`                                 |
| Runner crash    | `runner.last_error` — `{message, code, params}` or `null`                   | `backend/pipeline/runner.py`                                 |
| Overview status | `{status, phase, message, code, params, started_at}` per extractor          | `backend/course/runner.py`                                   |
| Download job    | `{…, message, code, params}` per job on `GET /jobs`                        | `downloader/server/src/jobs.js`                              |
| Run target      | `{…, disposition, code?}` per target on `GET /runs` and the runs SSE        | `downloader/server/src/runs.js`                              |
| Tool probe      | `tools[name]` — `"ok"`, or `{code, state, params}`                          | `lib/tools/`, reported on each service's `GET /tools`        |
| Data-root probe | `{ok: false, error, code, params}` at `200`                                 | `database/` `POST /settings/data-root/probe` (`data_root_*`) |
| Settings IPC    | `{code, params, message}` returned in place of the settings view            | `electron/store.js` via `faststudy:settings-write`           |

Every field is additive. `error`/`message` keep today's text and today's meaning, so a consumer that
never learned about `code` keeps working — which is what makes the fallback below honest rather than
theoretical.

`code` is a lower_snake_case identifier naming the failure, never the transport: `missing_prerequisite`,
not `conflict_409`. One namespace spans all four services, so the same fact gets the same code
wherever it is raised — `course_not_found` is one code whether `backend/` or `database/` answers it,
and one catalog row.

## Params are named values, never sentence fragments

`params` is flat: string, number, boolean or null, no nesting, no prose. A value that would be
spliced into the middle of an English sentence becomes a param, and the sentence becomes the
frontend's — Hebrew puts the same values in a different order, and
`frontend/docs/I18N.md`'s "never splice a translated fragment into another message" is the same rule
seen from the other end.

That forbids the tempting shortcut of shipping the English clause as a param. `EMPTY_FILE_ISSUES`
(`backend/pipeline/runner.py`) holds six explanatory hints, one per file; they stay in the English
prose, where a service's wording always may, and reach no param. `empty_file` carries only `{file}`,
off which the frontend keys its own clause.

`detail` is the one reserved param name: it holds text from outside this repo — ffmpeg, Groq, Gemini,
pandoc, tectonic, yt-dlp, curl, Playwright, Moodle, Google Drive, the OS. **Third-party text never
gets a code of its own.** It rides as `detail` on the code of whatever of ours wrapped it, and the
frontend renders it verbatim beneath a translated headline, direction-isolated so an English
stack trace cannot reorder the Hebrew sentence around it.

## `error` and `detail` may carry the same string

A wrapper whose only information is the third-party text sends that text twice — the four
`CodedError(str(e), "…", detail=str(e))` sites in `backend/pipeline/` and every fallback path in
`database/database_main.py`. The duplication is deliberate, because the two fields answer to
different readers and only coincide here. `error` is the developer-facing sentence: the one
human-readable field the row-less `dev` and `uncertain` codes carry at all, and what logs, a bare
`curl`, `delivery/smoke/` and `backend/services/db_client.py` print. `detail` is the block the UI
renders verbatim beneath a translated headline. Collapsing them would mean a per-code "this code's
detail is its prose" flag for the frontend to know when to promote `error` into the detail slot —
more machinery, and a second thing to keep in step, than the repeated string costs.

## Resolution and the unknown-code fallback

`frontend/src/shared/i18n/serviceErrors.ts` maps a code to a Lingui message descriptor, resolved with
its params at the render site. **An unknown code falls back to the service's own `error`/`message`
prose** — so a failure added to a service before its catalog row exists shows something real rather
than blank, and a service may add a code without waiting for the frontend.

A code with no catalog row is therefore a normal, supported state, not a bug. Every developer-facing
code below is exactly that: it carries a code for a uniform wire shape, and renders its English.

---

## Codes

`user` means a realistic user action produces it and it has a catalog row. `developer` means only a
bug in one of our own callers can, and it renders its English prose through the fallback.
`uncertain` means the call chain does not settle it; those carry a code and no catalog row.

### `backend/` — HTTP

| origin                            | code                       | params             | reach |
| --------------------------------- | -------------------------- | ------------------ | ----- |
| `backend_main.py` run/{step}      | `unknown_step`             | `step`             | dev   |
| `backend_main.py` run/{step}      | `step_disabled`            | `step`             | user  |
| `backend_main.py` run/{step}      | `missing_prerequisite`     | `file`, `step`     | user  |
| `course/runner.py` resolve        | `unknown_phase`            | `phase`            | dev   |
| `course/runner.py` resolve        | `unknown_extractors`       | `slugs`            | dev   |
| `backend_main.py` overview        | `course_not_found`         | `course`           | user  |
| `backend_main.py` overview, run-all| `data_root_not_configured`| —                  | user  |
| `timing/__init__.py` record       | `timing_operation_required`| —                  | dev   |
| `timing/__init__.py` record       | `unknown_timing_operation` | `operation`        | dev   |
| `timing/__init__.py` record       | `invalid_timing_sample`    | `field`, `value`   | dev   |
| `backend_main.py` probe-key       | `unknown_provider`         | `provider`         | dev   |
| `services/google_auth.py`         | `google_credentials_missing`| `path`            | user  |
| app-level handler                 | `storage_unavailable`      | `detail`           | user  |
| app-level handler                 | `internal_error`           | `detail`           | user  |

The last two come from a middleware because FastAPI's own 500 is plain text, which `failureError`
cannot parse — without it a user with `database/` down would read `500 Internal Server Error`.
`storage_unavailable` is `DbClientError` reaching the top of a route — a storage call that failed
and no route handled; `internal_error` is everything else. The middleware names only failures it was
given, so a refusal the user can act on is caught by the route instead and re-emitted under
`database/`'s own code (`_USER_ACTIONABLE_STORAGE_CODES` in `backend_main.py`, today just
`data_root_not_configured`), which is why that code appears in both tables.

### `backend/` — pipeline run errors

| origin                                  | code                        | params                          | reach |
| --------------------------------------- | --------------------------- | ------------------------------- | ----- |
| `pipeline/runner.py` step guards        | `missing_prerequisite`      | `file`, `step`                  | user  |
| `pipeline/runner.py` `_require_nonempty`| `empty_file`                | `file`                          | user  |
| `pipeline/runner.py` materials-only summarize | `materials_empty`     | —                               | user  |
| `services/errors.py` `own_fields`       | `app_files_blocked`         | —                               | user  |
| `pipeline/strip_audio.py`               | `audio_extraction_failed`   | `detail`                        | user  |
| `pipeline/transcribe.py`                | `transcription_failed`      | `detail`                        | user  |
| `pipeline/transcribe.py`                | `unreadable_audio`          | `file`                          | user  |
| `pipeline/transcribe.py`, `llm_client.py`| `missing_api_key`          | `provider`                      | user  |
| `pipeline/transcribe.py`, `llm_client.py`| `api_key_rejected`         | `provider`                      | user  |
| `services/llm_client.py`                | `gemini_quota_exhausted`    | `scope`, `model`, `limit`, `tier`| user |
| `pipeline/runner.py` blocked record     | `gemini_quota_blocked`      | `scope`, `model`, `limit`, `tier`| user |
| `services/llm_client.py`                | `gemini_overloaded`         | `model`                         | user  |
| `pipeline/transcribe.py`                | `groq_rate_limited`         | `limit`, `used`, `requested`, `retry_after_seconds` | user |
| `pipeline/runner.py` blocked record     | `groq_rate_limit_blocked`   | same as `groq_rate_limited`     | user  |
| `pipeline/summarize.py`                 | `summarization_failed`      | `detail`                        | user  |
| `pipeline/to_pdf.py`                    | `pdf_tool_timeout`          | `tool`, `seconds`               | user  |
| `pipeline/to_pdf.py`                    | `pdf_pandoc_failed`         | `detail`                        | user  |
| `pipeline/to_pdf.py`                    | `pdf_engine_no_output`      | `detail`                        | user  |
| `pipeline/to_pdf.py`                    | `pdf_missing_font`          | `detail`                        | user  |
| `pipeline/to_pdf.py`                    | `pdf_asset_missing`         | `asset`                         | user  |
| `pipeline/pdf/tex_errors.py`            | `latex_error`               | `message`, `line`, `at`, `more_count` | user |
| `pipeline/to_pdf.py`                    | `internal_missing_input`    | `file`                          | dev   |
| `pipeline/upload_to_drive.py`           | `drive_upload_failed`       | `detail`                        | user  |
| `services/google_auth.py`               | `drive_not_connected`       | —                               | user  |
| `pipeline/upload_to_drive.py`           | `drive_folder_not_configured`| —                              | user  |
| `services/google_auth.py`               | `internal_unknown_scope`    | `scope`                         | dev   |
| `pipeline/runner.py` fold               | `unknown_error`             | —                               | dev   |
| `pipeline/runner.py` `last_error`       | `run_crashed`               | `course`, `lecture`, `detail`   | user  |
| `services/db_client.py`                 | `file_not_found`            | `file`, `course`, `lecture`     | user  |
| `services/db_client.py`                 | `overview_file_not_found`   | `file`, `course`                | user  |
| `services/db_client.py`                 | `storage_error`             | `detail`                        | user  |

`latex_error`'s `message` and `at` are engine text and stay untranslated; the frame around them
(`LaTeX error:`, `line N:`, `and K more`) is the frontend's. `db_client` forwards the peer's own
`code`/`params` when `database/` supplied one, and falls back to `storage_error` when it did not —
which is also what carries `file_locked` through to a pipeline step error, a hop that loses the
HTTP status entirely.

`gemini_quota_exhausted` and `gemini_quota_blocked` replace the literal `code: "quota"`. The
run-scoped clearing sweep in `pipeline/runner.py` tests membership of those two rather than equality
with one string, and `provider` and `blocked` stay on the record — the frontend pins both.
`groq_rate_limited` and `groq_rate_limit_blocked` mirror that pair for Groq (`provider: "groq"`);
`retry_after_seconds` is `null` when Groq's message states no delay.
`gemini_overloaded` is Gemini's 503 `UNAVAILABLE` ("high demand"); it carries no `detail`, since
the raw text says only that and the step fails at once with no run-scoped block. It can also end a
course-overview `analyze` phase, which passes `llm_client`'s codes through.

### `backend/` — course overview

| origin                   | code                     | params            | reach |
| ------------------------ | ------------------------ | ----------------- | ----- |
| `course/runner.py`       | `already_generated`      | —                 | user  |
| `course/extract.py`      | `no_snippets_found`      | —                 | user  |
| `course/analyze.py`      | `missing_prerequisite`   | `file`, `step`    | user  |
| `course/to_pdf.py`       | `missing_prerequisite`   | `file`, `step`    | user  |
| `course/analyze.py`      | `empty_model_output`     | `provider`        | user  |
| `course/analyze.py`      | `analysis_failed`        | `detail`          | user  |
| `course/merge.py`        | `no_summaries_found`     | —                 | user  |
| `course/collect.py`      | `no_summaries_found`     | —                 | user  |
| `course/runner.py`       | `internal_unknown_phase` | `phase`           | dev   |
| `course/runner.py` worker| `internal_error`         | `detail`          | user  |

A phase worker's own exception no longer reaches this channel as a bare `str(e)`: the worker's code
and params ride through, and only a truly untyped exception falls back to `internal_error`.

A `skipped` entry is not a failure and never toasts. Its reason renders inline on the branch in the
course overview, on the same neutral badge a PDF render warning uses — `branchStatus()` in
`frontend/src/features/course-overview/constants/overview.ts` resolves it from the code like any
other. `already_generated` is the one skip that renders nothing: the branch already reads as done,
and every "Generate Course Overviews" pass re-stamps the code on every kept participant, so showing it would badge
every finished branch of a healthy course. It keeps its catalog row, which is the protocol's answer
for the code whichever view chooses to show it.

### `database/`

| origin                | code                            | params            | reach     |
| --------------------- | ------------------------------- | ----------------- | --------- |
| `fs/paths.py`         | `file_locked`                   | `file`            | user      |
| `fs/crud.py`          | `folder_in_use`                 | `name`            | user      |
| `fs/paths.py`         | `data_root_not_configured`      | —                 | user      |
| `fs/paths.py`         | `unsafe_path_segment`           | `segment`         | dev       |
| `fs/paths.py`         | `name_has_no_legal_characters`  | `name`            | user      |
| `fs/crud.py`          | `name_taken`                    | `name`            | user      |
| `fs/crud.py`          | `name_reserved`                 | `name`            | user      |
| `fs/crud.py`          | `file_not_removable`            | `file`            | dev       |
| `fs/crud.py`, `fs/summary.py` | `lecture_not_found`     | `course`, `lecture` | user    |
| `fs/overview.py`, `fs/summaries.py`, `fs/crud.py` | `course_not_found` | `course`          | user      |
| `settings.py`         | `setting_must_be_string`        | `field`           | dev       |
| `settings.py`, `database_main.py` | `setting_must_be_boolean` | `field`           | dev       |
| `settings.py`         | `setting_must_be_integer`       | `field`           | dev       |
| `settings.py`         | `setting_may_not_contain_quotes`| `field`           | user      |
| `settings.py`         | `unknown_setting`               | `field`           | dev       |
| `settings.py`         | `setting_invalid_choice`        | `field`, `value`  | dev       |
| `settings.py`         | `data_root_empty`               | —                 | user      |
| `settings.py`         | `data_root_not_absolute`        | `path`            | user      |
| `settings.py`         | `data_root_not_a_directory`     | `path`            | user      |
| `settings.py`         | `data_root_not_writable`        | `path`, `detail`  | user      |
| `database_main.py`, `fs/crud.py` | `bad_request_body`  | `detail`          | dev       |
| `database_main.py`    | `create_dir_failed`             | `path`, `detail`  | user      |
| `database_main.py`    | `rename_failed`                 | `from`, `to`, `detail` | user |
| `database_main.py`    | `file_write_failed`             | `file`, `detail`  | user      |
| `database_main.py`    | `file_read_failed`              | `file`, `detail`  | user      |
| `database_main.py`, `fs/crud.py` | `file_delete_failed` | `file`, `detail`  | user      |
| `database_main.py`    | `file_not_found`                | `file`            | user      |
| `database_main.py`    | `summary_io_failed`             | `detail`          | uncertain |
| `database_main.py`    | `overview_read_failed`          | `detail`          | uncertain |
| `database_main.py`    | `settings_store_io_failed`      | `detail`          | uncertain |

Reading, writing and deleting are three codes, not one: a wrong-verb sentence for a failed read is a
user-visible defect, not a naming quibble. Three params are knowingly thin — `file_write_failed` on
`POST /…/materials` carries no `file`, because the name is allocated inside the write that failed,
`file_read_failed` on `GET /…/materials` carries none because it lists a directory rather than reading
one file, and `overview_read_failed` covers all four overview read routes without one. The frontend's
`file_write_failed` and `file_read_failed` rows therefore select on `file` and name it only when it is
there.

Every route handler catches bare `Exception`, so an unlabelled stdlib exception is the common case,
not the exceptional one. The code therefore lives on the exception class — every authored message
crosses several frames before a route sees it — and `_failure` always emits a wrapper code with
`params.detail = str(exc)` rather than ever leaving `code` absent.

`file_locked` is the 423. It replaces the status-based special case the frontend used to carry: the
backend forwards the body into a pipeline error and loses the status, so only a code survives that
hop. Its sentence names `file`, so the user knows which program to close.

The four `Response("Not found", 404)` sites now answer a JSON `{error, code, params}` body like every
other failure; they previously fell through to the bare status line.

### `electron/` — settings IPC

`faststudy:settings-write` returns a refused patch instead of throwing, because Electron's IPC and
context bridge drop custom properties off an `Error`; the preload rejects with that plain object.
The shared codes keep `database/`'s spellings and params, so one catalog row serves both. They
carry rows despite being `dev`: a launcher/frontend key drift reaches real users.

| origin     | code                      | params                 | reach |
| ---------- | ------------------------- | ---------------------- | ----- |
| `store.js` | `unknown_setting`         | `field`                | dev   |
| `store.js` | `setting_must_be_string`  | `field`                | dev   |
| `store.js` | `setting_must_be_boolean` | `field`                | dev   |
| `store.js` | `setting_must_be_integer` | `field`                | dev   |
| `store.js` | `setting_invalid_choice`  | `field`, `value`       | dev   |
| `store.js` | `setting_out_of_range`    | `field`, `min`, `max`  | dev   |

### `downloader/server/`

| origin                    | channel    | code                        | params                     | reach |
| ------------------------- | ---------- | --------------------------- | -------------------------- | ----- |
| `routes/downloadItem.js`  | http       | `autodl_unreachable`        | `detail`                   | user  |
| `routes/downloadItem.js`  | http       | `autodl_no_target`          | —                          | uncertain |
| `services/database.js`    | http, job  | `database_store_failed`     | `detail`                   | user  |
| `routes/runs.js`          | http       | `run_unknown`               | —                          | user  |
| `routes/runs.js`          | http       | `run_not_paused`            | —                          | user  |
| `src/index.js`            | http       | `internal_error`            | `detail`                   | user  |
| routes, request checks    | http       | `invalid_request`           | `field`                    | user  |
| `downloaders/runner.js`   | job        | `download_tool_spawn_failed`| `tool`, `detail`           | user  |
| `downloaders/runner.js`   | job        | `download_tool_failed`      | `tool`, `exit_code`, `detail` | user |
| `downloaders/runner.js`   | job        | `download_auth_failed`      | `tool`, `exit_code`, `detail` | user |
| `downloaders/runner.js`   | job        | `download_failed`           | `tool`, `detail`           | uncertain |
| `routes/downloadItem.js`  | job        | `recapture_reconnect_required` | —                       | user  |
| `routes/downloadItem.js`  | job        | `recapture_passcode_required`  | —                       | user  |
| `routes/downloadItem.js`  | job        | `recapture_unsupported`     | `detail`                   | user  |
| `routes/downloadItem.js`  | job        | `recapture_failed`          | `detail`                   | user  |
| `routes/jobs.js`          | http       | `job_unknown`               | —                          | user  |
| `routes/generalFolder.js` | http       | `folder_picker_unavailable` | —                          | user  |
| `generalFolder.js`        | http       | `general_folder_missing`    | `folder`                   | user  |
| `generalFolder.js`        | http       | `general_folder_not_writable` | `folder`, `detail`       | user  |
| `generalFolder.js`        | http, job  | `general_folder_save_failed` | `folder`, `detail`        | user  |

`/download-item` and `/download-url` forward auto's `/resolve` refusal body verbatim, so a manual URL on
the Moodle site can answer auto's `moodle_busy`, `link_not_a_video`, `link_dead` or
`link_probe_inconclusive`; `autodl_unreachable` reaches `/download-url` for any URL, since only auto
can say which URLs are Moodle's.

A section run's target carries a `code` only as auto's `site_captcha_timeout` (no params): on the row
whose resolve timed out on the captcha, and on each later `moodle` row the run then fails unsent.

The `general_folder_*` codes are a general-video download into the user's chosen folder: `missing` and
`not_writable` answer `POST /general-folder` (400) and the three download routes (409); `save_failed`
ends a folder job, or answers a folder `/upload-pdf` with 500.

`services/database.js` forwards the database's own `code`/`params` (`name_reserved`, `file_locked`, …)
on both channels unchanged, so `database_store_failed` is only the fallback for a failure with no code
— a network error on the job path, or a non-JSON body. `/upload-pdf` keeps answering 502 either way.

`downloaders/runner.js` likewise ends a job whose file on auto was refused with auto's own
`code`/`params` (`site_blocked` with its `challengeWindow`, `moodle_reconnect_required`,
`moodle_file_unknown`); a body that is not auto's envelope falls back to `download_tool_failed` /
`download_auth_failed`. A re-resolve that auto answers `503 site_blocked` or `site_captcha_timeout`
likewise ends the job with that code and params, never `recapture_failed`.

The `❌` / `📥` / `♻️` / `✅` prefixes are not in any of this. They live only in `progress.js`'s
`console` wrappers; `services/database.js` logs the emoji line and returns the bare error, so nothing
emoji-prefixed ever reaches the SPA and no Hebrew sentence inherits one.

### `lib/tools/` — tool probe

A tool record on `GET /tools` of `backend/` and both downloader services. The frontend fetches each
once after the window opens and toasts one warning per broken tool, deduplicated by `tool` across
services; `state` stays as the developer-facing reason.

| origin          | code             | params              | reach |
| --------------- | ---------------- | ------------------- | ----- |
| `tools` probe   | `tool_missing`   | `tool`              | user  |
| `tools` probe   | `tool_timed_out` | `tool`, `seconds`   | user  |
| `tools` probe   | `tool_exited`    | `tool`, `exit_code` | user  |
| `tools` probe   | `tool_unusable`  | `tool`, `detail`    | user  |

### `downloader/auto/`

| origin                          | code                          | params                   | reach |
| ------------------------------- | ----------------------------- | ------------------------ | ----- |
| `http/server.js` `sendReconnect`| `moodle_reconnect_required`   | —                        | user  |
| `moodle/wsClient.js`            | `site_blocked`                | `detail`, `challengeWindow`? | user  |
| `moodle/wsClient.js`            | `site_captcha_timeout`        | —                        | user  |
| `lib/errors.js` `unreachable`   | `site_unreachable`            | `host`, `detail`         | user  |
| `http/server.js` `sendPasscode` | `zoom_passcode_required`      | `reason`, `course`, `name` | user |
| `browser/browserChannel.js`     | `browser_missing`             | `detail`                 | user  |
| `core/registry.js`              | `course_url_unsupported_site` | `url`, `site`            | user  |
| `core/registry.js`              | `moodle_site_not_configured`  | —                        | user  |
| `moodle/probe.js`, `auth/moodleToken.js`, `core/core.js` | `moodle_site_unsupported` | `site`, `reason`, `function` | user |
| `moodle/wsClient.js`            | `course_url_no_id`            | `url`                    | user  |
| `http/server.js` `/courses/check` | `course_url_not_course_page` | `url`                  | user  |
| `http/server.js` `/list`, `/courses/check` | `course_not_accessible` | `url`, `detail`       | user  |
| `core/core.js`                  | `link_not_a_video`            | `source`, `url`, `ext`   | user  |
| `core/core.js`                  | `link_dead`                   | `url`                    | user  |
| `core/core.js`                  | `link_probe_inconclusive`     | `url`                    | user  |
| `core/core.js`                  | `zoom_clip_missing`           | `name`                   | uncertain |
| `extractors/GoogleDriveExtractor.js` | `drive_not_shared`       | `url`                    | user  |
| `extractors/GoogleDriveExtractor.js` | `drive_link_malformed`   | `url`                    | user  |
| `extractors/YoutubePlaylistExtractor.js` | `expand_unsupported_host` | `host`             | user  |
| `extractors/YoutubePlaylistExtractor.js` | `playlist_list_failed` | `detail`              | user  |
| `extractors/YoutubePlaylistExtractor.js` | `playlist_empty`     | `url`                    | user  |
| `core/core.js` `resolveVideostream` | `videostream_no_mp4`   | `url`                    | user  |
| `extractors/ZoomExtractor.js`, `browser/zoomCaptcha.js` | `zoom_no_media_request` | `url` | user |
| `http/server.js` `/resolve`     | `zoom_browser_closed`         | `detail`                 | user  |
| `browser/zoomCaptcha.js`        | `zoom_captcha_unsupported`    | `url`                    | user  |
| `browser/zoomCaptcha.js`        | `zoom_captcha_timeout`        | `url`                    | user  |
| `browser/zoomBrowser.js`        | `xvfb_unavailable`            | `detail`                 | user  |
| `http/server.js` `/window/show` | `no_window_waiting`           | —                        | user  |
| `http/server.js` `resolveItem`  | `recording_strategy_unsupported` | `strategy`            | user  |
| `auth/moodleToken.js`           | `moodle_login_timeout`        | —                        | user  |
| `auth/moodleToken.js`           | `moodle_login_abandoned`      | —                        | user  |
| `auth/moodleToken.js`           | `moodle_login_not_pending`    | —                        | user  |
| `moodle/wsClient.js`            | `moodle_file_unreadable`      | `url`                    | uncertain |
| `moodle/wsClient.js` `WsError`  | `moodle_ws_error`             | `errorcode`, `detail`    | user  |
| `moodle/gate.js`                | `moodle_busy`                 | —                        | user  |
| `http/server.js` `/moodle/file` | `moodle_file_unknown`         | —                        | dev   |
| `moodle/gate.js`                | `moodle_call_ungated`         | `target`                 | dev   |
| `app.js` backstop               | `internal_error`              | `detail`                 | user  |
| `http/server.js`, request checks| `invalid_request`             | `field`                  | user  |

`UnsupportedError` and `PasscodeError` extend `CodedError` (`src/lib/errors.js`), so the code survives
the throw up to `handleResolve` and the backstop and the four typed refusals (401/409/422/503) relay
their thrower's code rather than only a message. A base class rather than a bare `err.code` tag
because **Node system errors already spell `err.code`** — `'ENOENT'` would otherwise reach the SPA as
a protocol code.

`browser_missing` reaches the SPA through two different responses — the 200 `{available:false}` body
of `/prereqs/browser` and the 500 backstop — and is one code in both.

`moodle_site_unsupported` is one code whose `reason` picks the sentence: `not_moodle`,
`mobile_service_off` and `maintenance` come from `POST /site/probe` (a 200 verdict, not an error body;
`maintenance` is retry-later), `missing_function` (with `function`) and `downloads_disabled` from
`/auth/complete`'s 422. `videostream_unavailable` — the token's service lacks `tool_mobile_get_content`,
so the login connects (and reports it to Sentry) and a videostream row's `/resolve` answers it as a 422. `courses_unavailable` — the service lacks `core_enrol_get_users_courses`; Sentry-only, never on the wire: the login connects and `GET /courses` answers `{available:false}`. An `unverified` probe carries no code — only `params.detail` (`site_blocked`,
`timeout`, `network`), plus `challengeWindow` beside a `site_blocked`.

`site_blocked`'s `challengeWindow` is present only on a block from a call the challenge window can
carry (a WS call, a Moodle PDF): `false` when no browser could launch. A routed call that meets a
captcha waits for the user's solve and resends itself through the window, so no 503 is sent; it ends
on `site_captcha_timeout` when the captcha stays unsolved for the window's 10-minute cap, and on
`site_blocked` with no `challengeWindow` when the user closes the window, while it loads included. `'captcha'` reaches a client
only from `/site/probe` or a call that wait cannot cover (the window's reopen cap spent). A window that
opens hidden with its clearance still valid carries the call itself, so no 503 is sent; `'ready'` (the user only repeats the action) reaches a client only from
`/site/probe` or from a call already going through the window whose reload landed on the site. A block
from any other path (a pasted link, a link probe) leaves it absent. The videostream handler call is a
WS call, so its block carries it.

`site_unreachable` is a 503 with no `status`, so the SPA never mistakes it for a block. It comes from a fetch
to an upstream host that failed in the network (a connect timeout, a DNS miss or a reset), from Node or
through the challenge window's page. It answers `/list`,
`/courses`, `/courses/check` and `/resolve` (Moodle WS and Google Drive). `host` is that request's hostname,
and `detail` is undici's cause verbatim, or through the page only Chrome's `ERR_*` code (`null` when
none was reported); a timeout's `detail` is its own message on either route. It is not reported to Sentry, since an unreachable site is not a bug.

Three details of the params. `link_not_a_video`'s `ext` has no leading dot (`pptx`), though the
English prose still prints `.pptx`; `ext: null` means a web page. `zoom_passcode_required`'s `course`
and `name` are filled by the route, not the thrower — the passcode gate knows neither. And `detail`
is `null` rather than absent wherever there was nothing to carry: an empty stderr tail, a Moodle
error with no `message`, a 422 that carried no message.

---

## Excluded, and why

**Request-validation bodies keep their English.** The downloader's `valid url required` family — 24
bodies in `server/src/routes/` and 10 in `auto/src/http/server.js` — guards values our own popup, SPA
or peer call shaped, so reaching one means a bug in the caller and the English text is the useful
signal for whoever debugs it — the English stays in the body and the service logs. They carry
`invalid_request` with the offending `field` for a uniform wire shape. Same for the developer-facing
rows marked `dev` above, which have no catalog row.

The exception is the `storedName` family: a name typed into a downloads row (`a/b`) reaches it, so the
server's `invalid_request` row is `user`. So is auto's: a course URL saved anyway without a scheme
reaches `/list`'s `courseUrl` check. The one catalog row names the problem for `field` `name`, `course`
and `courseUrl`, and reads as a generic failure for any other field, which is still a caller bug.

**Third-party text is never translated.** ffmpeg's stderr, a tectonic log tail, Moodle's own error
message, an `OSError` string — these are often the only string that identifies the failure, and no
protocol can translate them. They render verbatim, direction-isolated, beneath a translated headline
naming what failed.

**Out of scope by decision:** the `downloader/extension/` popup, which is not the SPA; the date and
duration gap in `frontend/src/shared/utils/format.ts`; a third locale; and sending the user's locale
to any service.

## Known holes

- **The SSE 401 carries no body.** `lib/runtime/` answers an `EventSource` 401 with an empty
  `text/event-stream`, deliberately — Chromium turns any other MIME into a bare `onerror`. A
  body-carried code cannot reach an SSE caller, so that one failure stays code-less.
- **FastAPI's own 422** answers `{detail: [...]}`, not `{error}`, for a malformed request body or an
  invalid `kind`. Shape and prose are both pydantic's. Developer-facing; left alone.
- **`course/analyze.py` does not special-case a Gemini daily quota.** The code rides through from
  `llm_client`, so the entry does read `gemini_quota_exhausted` — but there is no run-scoped block
  and no `provider` field, so the overview has nothing like the pipeline's blocked records.
- **A PDF render warning carries no code.** `.pdf_warning` is a file `database/` inlines into the
  tree as a plain string, not one of the four channels above, so `tectonic exited N with no
  reported error` and a recovered render's `LaTeX error: …` stay English prose. Giving the marker a
  code would mean changing its on-disk format in three services at once.
- **The drift test greps; it does not parse.** `frontend/src/shared/i18n/errorCodeDrift.test.ts`
  holds the codes the services emit, the tables above and `serviceErrors.ts`'s rows to one
  vocabulary — but it finds a code by the shapes one is written in: a literal in a known argument
  position, `code = "x"`, `"code": "x"`. A code reached through a ternary, returned inside a tuple
  or defaulted behind an `or` is invisible to it, so it misses silently and never cries wolf.
  Closing that would take a generated registry every service imports, and `lib/` reaches neither
  `frontend/` nor `electron/` — such a registry would be a second source of truth, not one.
