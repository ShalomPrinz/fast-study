import { msg } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { MessageDescriptor } from '@lingui/core'

// A flat bag of named values; the protocol allows no nesting and no prose (docs/ERROR-CODES.md).
export type ErrorParams = Record<string, string | number | boolean | null>

// A failure exactly as any of the services reports it: English prose plus the machine code and
// params the protocol carries beside it.
export interface ServiceFailure {
  message: string
  code?: string | null
  params?: ErrorParams | null
}

// What a failure reads as: one translated sentence, and third-party text to print verbatim under
// it. `detail` is never translated and is rendered direction-isolated (`ServiceError`).
export interface ResolvedFailure {
  headline: string
  detail: string | null
}

// Every code with a sentence of its own, keyed exactly as the services spell it. A code absent
// here renders the service's English prose instead — the `dev` and `uncertain` rows of
// docs/ERROR-CODES.md are deliberately absent, and so is anything a service adds before its row.
// The messages are written as raw ICU so the params bind at resolve time, not at module load.
const MESSAGES: Record<string, MessageDescriptor> = {
  // Shared across services
  // `download` is the one prerequisite no pipeline step produces: the video comes from a download.
  missing_prerequisite: msg({
    message:
      '{step, select, download {This step needs {file}, which is not there yet. Download the lecture video first.} other {This step needs {file}, which is not there yet. Run the step before it first.}}',
  }),
  course_not_found: msg({ message: 'The course "{course}" was not found.' }),
  lecture_not_found: msg({
    message: '"{lecture}" no longer exists in "{course}". It may have been renamed or deleted.',
  }),
  file_not_found: msg({ message: '{file} was not found.' }),
  internal_error: msg({ message: 'Something went wrong.' }),
  storage_unavailable: msg({
    message: "Part of FastStudy isn't responding. Restart the app.",
  }),
  storage_error: msg({ message: "FastStudy couldn't reach your files. Try again." }),

  // backend — HTTP
  step_disabled: msg({ message: 'That step is turned off in settings.' }),
  google_credentials_missing: msg({
    message: "Google Drive can't be connected: a file FastStudy needs is missing from {path}.",
  }),

  // backend — pipeline
  empty_file: msg({ message: '{file} came out empty. Run the step that creates it again.' }),
  audio_extraction_failed: msg({ message: 'Could not extract the audio from the video.' }),
  transcription_failed: msg({ message: 'Transcribing the audio failed.' }),
  unreadable_audio: msg({ message: 'Could not read the audio in {file}.' }),
  missing_api_key: msg({
    message:
      '{provider, select, gemini {The Gemini API key is not set. Add it in Settings.} groq {The Groq API key is not set. Add it in Settings.} other {The {provider} API key is not set. Add it in Settings.}}',
  }),
  api_key_rejected: msg({
    message:
      '{provider, select, gemini {The Gemini API key was rejected. Check it in Settings.} groq {The Groq API key was rejected. Check it in Settings.} other {The {provider} API key was rejected. Check it in Settings.}}',
  }),
  gemini_quota_exhausted: msg({
    message:
      "{scope, select, daily {Gemini's daily quota is used up. It resets at midnight Pacific time.} other {Gemini's rate limit was reached. Try again in a minute.}}",
  }),
  gemini_quota_blocked: msg({
    message: "Gemini's daily quota is used up. It resets at midnight Pacific time.",
  }),
  groq_rate_limited: msg({
    message: "Groq's rate limit was reached. Try again in a few minutes.",
  }),
  groq_rate_limit_blocked: msg({
    message: "Groq's rate limit was reached, so this step was not attempted.",
  }),
  summarization_failed: msg({ message: 'Summarizing the transcript failed.' }),
  pdf_tool_timeout: msg({
    message: 'Building the PDF took too long and was stopped after {seconds} seconds.',
  }),
  pdf_pandoc_failed: msg({ message: 'Could not convert the summary for printing.' }),
  pdf_engine_no_output: msg({ message: 'The PDF could not be created.' }),
  pdf_missing_font: msg({ message: 'A font the PDF needs is missing.' }),
  pdf_asset_missing: msg({ message: 'A file the PDF template needs is missing: {asset}.' }),
  // The frame is ours; the engine's own error text rides in `detail` (see `detailOf`).
  latex_error: msg({
    message:
      '{more_count, plural, =0 {Something in the summary stopped the PDF from being built.} other {Something in the summary stopped the PDF from being built, along with # more problems.}}',
  }),
  drive_upload_failed: msg({ message: 'Uploading to Google Drive failed.' }),
  drive_not_connected: msg({ message: 'Google Drive is not connected. Connect it in Settings.' }),
  drive_folder_not_configured: msg({
    message: 'No Google Drive folder is set. Choose one in Settings.',
  }),
  run_crashed: msg({ message: 'The run stopped unexpectedly on "{course}" / "{lecture}".' }),
  overview_file_not_found: msg({ message: "{file} was not found in the course's overview." }),

  // backend — course overview
  already_generated: msg({ message: 'Already generated.' }),
  no_snippets_found: msg({ message: 'Nothing was found to analyze in this course.' }),
  analysis_failed: msg({ message: 'Analyzing the collected passages failed.' }),
  empty_model_output: msg({
    message:
      '{provider, select, gemini {Gemini returned nothing. Try again.} other {The model returned nothing. Try again.}}',
  }),
  no_summaries_found: msg({ message: 'This course has no summaries yet.' }),

  // database
  file_locked: msg({
    message:
      '{file, select, undefined {The file is open in another program. Close it and try again.} other {"{file}" is open in another program. Close it and try again.}}',
  }),
  folder_in_use: msg({
    message: 'A file inside "{name}" is open in another program. Close it and try again.',
  }),
  name_has_no_legal_characters: msg({
    message: '"{name}" has no characters that can be used in a folder name.',
  }),
  name_taken: msg({ message: 'A course or lecture named "{name}" already exists.' }),
  name_reserved: msg({
    message: '"{name}" is reserved for the course\'s own folders. Choose another name.',
  }),
  setting_may_not_contain_quotes: msg({
    message: 'That setting may not contain quotes or line breaks.',
  }),
  data_root_not_configured: msg({ message: 'No data folder is set. Choose one in Settings.' }),
  data_root_empty: msg({ message: 'Choose a data folder.' }),
  data_root_not_absolute: msg({ message: 'The data folder must be a full path: {path}.' }),
  data_root_not_a_directory: msg({ message: '{path} exists but is not a folder.' }),
  data_root_not_writable: msg({ message: '{path} cannot be written to.' }),
  create_dir_failed: msg({ message: 'Could not create "{path}".' }),
  rename_failed: msg({ message: 'Could not rename "{from}" to "{to}".' }),
  file_write_failed: msg({
    message: '{file, select, undefined {Could not save the file.} other {Could not save {file}.}}',
  }),
  file_read_failed: msg({
    message: '{file, select, undefined {Could not read the file.} other {Could not read {file}.}}',
  }),
  file_delete_failed: msg({ message: 'Could not delete {file}.' }),

  // downloader/server
  // Only `name`/`course` are reachable by the user (a typed row name); any other field is a caller bug.
  invalid_request: msg({
    message:
      "{field, select, name {That name can't be used as a folder name. Use letters or numbers, and no / or \\.} course {That course name can't be used as a folder name.} lecture {That lecture name can't be used as a folder name.} url {That link isn't valid. Paste a full address starting with http:// or https://.} other {Something went wrong.}}",
  }),
  autodl_unreachable: msg({
    message: "The part of FastStudy that downloads recordings isn't responding. Restart the app.",
  }),
  database_store_failed: msg({ message: 'The downloaded file could not be stored.' }),
  run_unknown: msg({ message: 'That download run no longer exists.' }),
  run_not_paused: msg({ message: 'That download run is not paused.' }),
  download_tool_spawn_failed: msg({ message: "The download couldn't start." }),
  download_tool_failed: msg({ message: 'The download failed.' }),
  download_auth_failed: msg({
    message: 'The download was refused — the session has expired. Reconnect the account.',
  }),
  recapture_reconnect_required: msg({
    message: 'The Moodle session expired. Reconnect the account and try again.',
  }),
  recapture_passcode_required: msg({ message: 'This recording needs a passcode.' }),
  recapture_unsupported: msg({ message: "This source can't be downloaded automatically." }),
  recapture_failed: msg({
    message: "Couldn't work out where to download this from. Try again.",
  }),

  // lib/tools — the boot probe each service reports on `GET /tools`; no exit code: it means nothing to the user.
  tool_missing: msg({
    message:
      '{tool} is missing, so the parts of FastStudy that need it will fail. Reinstall FastStudy to fix this.',
  }),
  tool_timed_out: msg({
    message:
      "{tool} didn't respond within {seconds} seconds, so the parts of FastStudy that need it may fail.",
  }),
  tool_exited: msg({
    message:
      "{tool} doesn't run correctly, so the parts of FastStudy that need it will fail. Reinstall FastStudy to fix this.",
  }),
  tool_unusable: msg({
    message: "{tool} can't be started, so the parts of FastStudy that need it will fail.",
  }),

  // downloader/auto
  moodle_reconnect_required: msg({
    message: 'The Moodle session expired. Reconnect the account and try again.',
  }),
  site_blocked: msg({
    message:
      'The university site is temporarily refusing automated requests. Wait a few minutes and try again.',
  }),
  moodle_busy: msg({
    message: 'The university site is busy with another request. Try again in a moment.',
  }),
  zoom_passcode_required: msg({
    message:
      '{reason, select, incorrect {The Zoom passcode is wrong. Enter it again.} other {This Zoom recording needs a passcode.}}',
  }),
  browser_missing: msg({
    message: 'No Chrome or Edge was found on this computer. Install Chrome and try again.',
  }),
  course_url_unsupported_site: msg({
    message: "That course link is not from your university's site ({site}): {url}.",
  }),
  moodle_site_not_configured: msg({
    message: 'No university is chosen yet. Choose yours in Settings.',
  }),
  moodle_site_unsupported: msg({
    message:
      "{reason, select, not_moodle {This address isn't a Moodle site. Check it and try again.} mobile_service_off {This university's Moodle doesn't allow signing in from the Moodle app, which FastStudy relies on.} maintenance {This university's Moodle is under maintenance right now. Try again later.} missing_function {This university's Moodle doesn't let the Moodle app read course contents ({function}), so FastStudy can't use it.} downloads_disabled {This university's Moodle doesn't let the Moodle app download files, so FastStudy can't use it.} autologin_unavailable {This university's Moodle doesn't let the app open videos hosted on Moodle itself. Other recordings and course files still work.} other {This university's Moodle can't be used with FastStudy.}}",
  }),
  course_url_no_id: msg({ message: "That course link doesn't point to a specific course: {url}." }),
  link_not_a_video: msg({
    message:
      '{ext, select, undefined {{url} is a web page, not a file. Open it in a browser and download it yourself.} other {{url} is a {ext} file, not a video. Open it in a browser and download it yourself.}}',
  }),
  link_dead: msg({
    message: '{url} no longer exists. Check the course page for a new link.',
  }),
  link_probe_inconclusive: msg({
    message: "Could not tell what {url} is — the site didn't answer usefully.",
  }),
  drive_not_shared: msg({
    message:
      'This Google Drive file is not shared publicly, or was removed. Open it in a browser and download it yourself.',
  }),
  drive_link_malformed: msg({ message: 'That is not a Google Drive file link: {url}.' }),
  expand_unsupported_host: msg({
    message: 'Only YouTube playlists can be opened up; {host} cannot.',
  }),
  playlist_list_failed: msg({ message: 'Could not list the playlist.' }),
  playlist_empty: msg({ message: 'That playlist has no entries.' }),
  videostream_no_media_request: msg({
    message: 'No video was captured on that page. Play it once by hand and try again.',
  }),
  zoom_no_media_request: msg({
    message:
      'No video was captured on that Zoom page. The passcode or the player may need a manual start.',
  }),
  xvfb_unavailable: msg({ message: "Couldn't start capturing the Zoom recording. Try again." }),
  moodle_token_no_privatetoken: msg({
    message: "This Moodle connection can't download these recordings. Reconnect the account.",
  }),
  moodle_login_timeout: msg({ message: 'The Moodle login timed out. Try connecting again.' }),
  moodle_login_abandoned: msg({
    message: 'The login window was closed before login finished. Connect again.',
  }),
  moodle_login_not_pending: msg({ message: 'No login is in progress. Connect again.' }),
  moodle_ws_error: msg({ message: 'Moodle refused the request.' }),
}

// The catalog row for a code, or null when it has none — the caller then falls back to prose.
export function serviceErrorRow(code: string | null | undefined): MessageDescriptor | null {
  return (code && MESSAGES[code]) || null
}

// Third-party text to print verbatim: the reserved `detail` param, or, for `latex_error`, the TeX
// engine's own words, which arrive as named values rather than under `detail`.
function detailOf(code: string, params: ErrorParams): string | null {
  if (code === 'latex_error') {
    const at = typeof params.at === 'string' ? params.at : ''
    const where = params.line == null ? at : `l.${params.line} ${at}`.trim()
    return [params.message, where].filter(Boolean).join('\n') || null
  }
  return typeof params.detail === 'string' && params.detail ? params.detail : null
}

// A null param must fall to a message's `undefined` branch like an absent one, so both spellings
// of "nothing to say" pick the same clause.
function present(params: ErrorParams): ErrorParams {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
}

// The sentence a failure reads as. An unknown code — or none at all — falls back to the service's
// own English prose, so a failure always says something real.
export function resolveServiceError(failure: ServiceFailure): ResolvedFailure {
  const params = failure.params ?? {}
  const row = serviceErrorRow(failure.code)
  if (!row) return { headline: failure.message, detail: null }
  // The id/values form, not `_(descriptor)`: the descriptor carries no values of its own, and the
  // ones it does carry would win over the failure's (`@lingui/core`'s `_`).
  return {
    headline: i18n._(row.id, present(params), { message: row.message }),
    detail: detailOf(failure.code as string, params),
  }
}

// One-string form, for an attribute that cannot hold markup (a `title` tooltip).
export function serviceErrorText(failure: ServiceFailure): string {
  const { headline, detail } = resolveServiceError(failure)
  return detail ? `${headline}\n${detail}` : headline
}

// What identifies a failure for "report it once" dedupe: the facts, not their wording, so a locale
// switch mid-run does not re-announce everything.
export function failureId(failure: ServiceFailure): string {
  return `${failure.code ?? ''}|${JSON.stringify(failure.params ?? {})}|${failure.message}`
}
