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
| Tool probe      | `tools[name]` — `"ok"`, or `{state, params}`                                | `lib/tools/`, reported on each service's `/health`           |

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
| `pipeline/strip_audio.py`               | `audio_extraction_failed`   | `detail`                        | user  |
| `pipeline/transcribe.py`                | `transcription_failed`      | `detail`                        | user  |
| `pipeline/transcribe.py`                | `unreadable_audio`          | `file`                          | user  |
| `pipeline/transcribe.py`, `llm_client.py`| `missing_api_key`          | `provider`                      | user  |
| `services/llm_client.py`                | `gemini_quota_exhausted`    | `scope`, `model`, `limit`, `tier`| user |
| `pipeline/runner.py` blocked record     | `gemini_quota_blocked`      | `scope`, `model`, `limit`, `tier`| user |
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

### `backend/` — course overview

| origin                   | code                     | params            | reach |
| ------------------------ | ------------------------ | ----------------- | ----- |
| `course/runner.py`       | `already_generated`      | —                 | user  |
| `course/extract.py`      | `no_snippets_found`      | —                 | user  |
| `course/analyze.py`      | `missing_prerequisite`   | `file`, `step`    | user  |
| `course/to_pdf.py`       | `missing_prerequisite`   | `file`, `step`    | user  |
| `course/analyze.py`      | `empty_model_output`     | `provider`        | user  |
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
and every "Generate All" pass re-stamps the code on every kept participant, so showing it would badge
every finished branch of a healthy course. It keeps its catalog row, which is the protocol's answer
for the code whichever view chooses to show it.

### `database/`

| origin                | code                            | params            | reach     |
| --------------------- | ------------------------------- | ----------------- | --------- |
| `fs/paths.py`         | `file_locked`                   | `file`            | user      |
| `fs/paths.py`         | `data_root_not_configured`      | —                 | user      |
| `fs/paths.py`         | `unsafe_path_segment`           | `segment`         | dev       |
| `fs/paths.py`         | `name_has_no_legal_characters`  | `name`            | user      |
| `fs/overview.py`, `fs/summaries.py` | `course_not_found`  | `course`          | user      |
| `settings.py`         | `setting_must_be_string`        | `field`           | dev       |
| `settings.py`         | `setting_must_be_boolean`       | `field`           | dev       |
| `settings.py`         | `setting_must_be_integer`       | `field`           | dev       |
| `settings.py`         | `setting_may_not_contain_quotes`| `field`           | user      |
| `settings.py`         | `unknown_setting`               | `field`           | dev       |
| `settings.py`         | `data_root_empty`               | —                 | user      |
| `settings.py`         | `data_root_not_absolute`        | `path`            | user      |
| `settings.py`         | `data_root_not_a_directory`     | `path`            | user      |
| `settings.py`         | `data_root_not_writable`        | `path`, `detail`  | user      |
| `database_main.py`    | `bad_request_body`              | `detail`          | dev       |
| `database_main.py`    | `create_dir_failed`             | `path`, `detail`  | user      |
| `database_main.py`    | `rename_failed`                 | `from`, `to`, `detail` | user |
| `database_main.py`    | `file_write_failed`             | `file`, `detail`  | user      |
| `database_main.py`    | `file_read_failed`              | `file`, `detail`  | user      |
| `database_main.py`    | `file_delete_failed`            | `file`, `detail`  | user      |
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
hop. It carries `file` although today's sentence does not name the file — the wording is unchanged
from before this protocol, and the param is what lets it gain the filename later without a contract
change.

The four `Response("Not found", 404)` sites now answer a JSON `{error, code, params}` body like every
other failure; they previously fell through to the bare status line.

### `downloader/server/`

| origin                    | channel    | code                        | params                     | reach |
| ------------------------- | ---------- | --------------------------- | -------------------------- | ----- |
| `routes/downloadItem.js`  | http       | `autodl_unreachable`        | `detail`                   | user  |
| `routes/downloadItem.js`  | http       | `autodl_no_target`          | —                          | uncertain |
| `services/database.js`    | http, job  | `database_store_failed`     | `detail`                   | user  |
| `routes/runs.js`          | http       | `run_unknown`               | —                          | user  |
| `routes/runs.js`          | http       | `run_not_paused`            | —                          | user  |
| `src/index.js`            | http       | `internal_error`            | `detail`                   | user  |
| routes, request checks    | http       | `invalid_request`           | `field`                    | dev   |
| `downloaders/runner.js`   | job        | `download_tool_spawn_failed`| `tool`, `detail`           | user  |
| `downloaders/runner.js`   | job        | `download_tool_failed`      | `tool`, `exit_code`, `detail` | user |
| `downloaders/runner.js`   | job        | `download_auth_failed`      | `tool`, `exit_code`, `detail` | user |
| `downloaders/runner.js`   | job        | `download_failed`           | `tool`, `detail`           | uncertain |
| `routes/downloadItem.js`  | job        | `recapture_reconnect_required` | —                       | user  |
| `routes/downloadItem.js`  | job        | `recapture_passcode_required`  | —                       | user  |
| `routes/downloadItem.js`  | job        | `recapture_unsupported`     | `detail`                   | user  |
| `routes/downloadItem.js`  | job        | `recapture_failed`          | `detail`                   | user  |

The `❌` / `📥` / `♻️` / `✅` prefixes are not in any of this. They live only in `progress.js`'s
`console` wrappers; `services/database.js` logs the emoji line and returns the bare error, so nothing
emoji-prefixed ever reaches the SPA and no Hebrew sentence inherits one.

### `downloader/auto/`

| origin                          | code                          | params                   | reach |
| ------------------------------- | ----------------------------- | ------------------------ | ----- |
| `http/server.js` `sendReconnect`| `moodle_reconnect_required`   | —                        | user  |
| `moodle/wsClient.js`            | `site_blocked`                | `detail`                 | user  |
| `http/server.js` `sendPasscode` | `zoom_passcode_required`      | `reason`, `course`, `name` | user |
| `browser/browserChannel.js`     | `browser_missing`             | `detail`                 | user  |
| `core/registry.js`              | `course_url_unsupported_site` | `url`                    | user  |
| `moodle/wsClient.js`            | `course_url_no_id`            | `url`                    | user  |
| `core/core.js`                  | `link_not_a_video`            | `source`, `url`, `ext`   | user  |
| `core/core.js`                  | `link_dead`                   | `url`                    | user  |
| `core/core.js`                  | `link_probe_inconclusive`     | `url`                    | user  |
| `core/core.js`                  | `zoom_clip_missing`           | `name`                   | uncertain |
| `extractors/GoogleDriveExtractor.js` | `drive_not_shared`       | `url`                    | user  |
| `extractors/GoogleDriveExtractor.js` | `drive_link_malformed`   | `url`                    | user  |
| `extractors/YoutubePlaylistExtractor.js` | `expand_unsupported_host` | `host`             | user  |
| `extractors/YoutubePlaylistExtractor.js` | `playlist_list_failed` | `detail`              | user  |
| `extractors/YoutubePlaylistExtractor.js` | `playlist_empty`     | `url`                    | user  |
| `extractors/VideostreamExtractor.js` | `videostream_no_media_request` | `url`              | user  |
| `extractors/ZoomExtractor.js`   | `zoom_no_media_request`       | `url`                    | user  |
| `browser/zoomBrowser.js`        | `xvfb_unavailable`            | `detail`                 | user  |
| `http/server.js`                | `moodle_token_no_privatetoken`| —                        | user  |
| `auth/moodleToken.js`           | `moodle_login_timeout`        | —                        | user  |
| `moodle/wsClient.js`            | `moodle_file_unreadable`      | `url`                    | uncertain |
| `moodle/wsClient.js` `WsError`  | `moodle_ws_error`             | `errorcode`, `detail`    | user  |
| `app.js` backstop               | `internal_error`              | `detail`                 | user  |
| `http/server.js`, request checks| `invalid_request`             | `field`                  | dev   |

`UnsupportedError` and `PasscodeError` extend `CodedError` (`src/lib/errors.js`), so the code survives
the throw up to `handleResolve` and the backstop and the four typed refusals (401/409/422/503) relay
their thrower's code rather than only a message. A base class rather than a bare `err.code` tag
because **Node system errors already spell `err.code`** — `'ENOENT'` would otherwise reach the SPA as
a protocol code.

`browser_missing` reaches the SPA through two different responses — the 200 `{available:false}` body
of `/prereqs/browser` and the 500 backstop — and is one code in both.

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
signal for whoever debugs it. They carry `invalid_request` with the offending `field` for a uniform
wire shape, and no catalog row. Same for the developer-facing rows marked `dev` above.

One caveat is recorded rather than reclassified: the `storedName` family is the one excluded row a
user could in principle reach, if a Moodle row were titled only from `<>:"/\|?*` and canonicalized to
empty. It cannot fire from today's UI, where names come from row titles the server canonicalizes and
reports back as `renames`.

**Third-party text is never translated.** ffmpeg's stderr, a tectonic log tail, Moodle's own error
message, an `OSError` string — these are often the only string that identifies the failure, and no
protocol can translate them. They render verbatim, direction-isolated, beneath a translated headline
naming what failed.

**The tool probe carries no code.** `lib/tools/`'s boot-time probe reports a usable tool as the
bare string `"ok"` and an unusable one as `{state, params}` — `state` is the one-line
developer-facing reason (`missing`, `exited 3`), `params` the values a sentence would need. There is
no code because nothing would resolve one: the frontend never reads `/health`, and the probe's only
user-facing render is `electron/boot.js`, the launch screen, which has no catalogs and prints
English. A code nothing resolves is a field nothing checks. `params` stays, because it is what a
localized launch screen would key its own sentence off. Success stays a bare string on purpose:
every consumer compares `!= "ok"`, and an object is never equal to it, so `backend/`, both
downloader services, `electron/` and the release smoke suite all keep their meaning.

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
