// Thin fetch wrapper over Moodle's Web-Services REST API; a wstoken authenticates every call —
// no browser, no cookies. Protocol reference: docs/MOODLE.md.
import { CodedError } from '../lib/errors.js';
import { enterMoodle } from './gate.js';

// Every request to a Moodle goes through here: the gate first, then the network (docs/GATE.md).
async function moodleFetch(url, init) {
  await enterMoodle(String(url).split('?')[0]);
  return fetch(url, init);
}

/** A Moodle WS exception body ({ exception, errorcode, message }) surfaced as an Error. */
export class WsError extends CodedError {
  constructor(errorcode, message) {
    super('moodle_ws_error', { errorcode, detail: message ?? null }, message || errorcode);
    this.name = 'WsError';
    this.errorcode = errorcode;
  }
}

/**
 * The site answered with a bot-protection challenge instead of what was asked for — an HTML
 * page or a redirect where a WS body or a file was due. A site behind a bot manager (BIU's Radware)
 * serves one (HTTP 200, text/html) to a client it reads as automated, so this is a distinct failure
 * from a WS fault and never a JSON parse bug.
 */
export class WsBlockedError extends CodedError {
  constructor(detail) {
    super(
      'site_blocked',
      { detail },
      `the site is refusing automated requests — it served a bot-protection challenge ` +
        `instead of a valid response (${detail}); wait a few minutes and retry`,
    );
    this.name = 'WsBlockedError';
  }
}

/** @returns {boolean} true when a thrown error is the site's bot-protection challenge. */
export function blocked(err) {
  return err instanceof WsBlockedError;
}

// Moodle answers a dead/expired token with HTTP 200 + an exception body, not a 401.
// The signal is the errorcode, so key on it rather than the message text.
const INVALID_TOKEN_CODES = new Set(['invalidtoken', 'accessexception']);

/** @returns {boolean} true when a thrown WsError is Moodle's invalid/expired-token signal. */
export function invalidToken(err) {
  return err instanceof WsError && INVALID_TOKEN_CODES.has(err.errorcode);
}

// The token is minted as the mobile app's, and Moodle's is_moodle_app() gates app-only functions
// on `MoodleMobile` in the UA.
const APP_USER_AGENT = 'MoodleMobile 4.4.0 (44000)';

// A challenge answers 302 or 200 text/html; parsing either as JSON would only report a
// SyntaxError, hiding the real cause. Check before touching the body.
async function jsonOrBlocked(res) {
  if (res.status >= 300 && res.status < 400)
    throw new WsBlockedError(`HTTP ${res.status} redirect`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json'))
    throw new WsBlockedError(`HTTP ${res.status}, ${type || 'no content-type'}`);
  return res.json();
}

// One WS call against `site`. With `post`, the extra params move to a form-encoded body. An
// `.exception` body (under HTTP 200) throws WsError; a non-JSON answer is the challenge → WsBlockedError.
async function callWs(site, token, fn, params = {}, { post = false } = {}) {
  const url = new URL(`${site}/webservice/rest/server.php`);
  url.searchParams.set('wstoken', token);
  url.searchParams.set('moodlewsrestformat', 'json');
  url.searchParams.set('wsfunction', fn);

  const init = { headers: { 'User-Agent': APP_USER_AGENT } };
  if (post) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) form.set(k, String(v));
    init.method = 'POST';
    init.body = form;
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }

  const body = await jsonOrBlocked(await moodleFetch(url, init));
  if (body && body.exception) throw new WsError(body.errorcode, body.message);
  return body;
}

/** The root answered, but not as Moodle: the path does not exist there, or its JSON is not Moodle's. */
export class NotMoodleError extends Error {
  constructor(detail) {
    super(`not a Moodle answer (${detail})`);
    this.name = 'NotMoodleError';
  }
}

/** A 3xx where a WS body was due; `location` is the absolute http(s) target, or null when there is none. */
export class WsRedirectError extends WsBlockedError {
  constructor(status, location) {
    super(`HTTP ${status} redirect`);
    this.name = 'WsRedirectError';
    this.location = location;
  }
}

// `location` resolved against the request URL, or null when absent, unparseable or not http(s).
function redirectTarget(location, requestUrl) {
  if (!location) return null;
  try {
    const u = new URL(location, requestUrl);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// A server with no such script answers these; a bot wall answers 200 or a redirect, or 403 (Cloudflare).
const NO_SUCH_PATH = new Set([404, 405, 410]);

/**
 * tool_mobile_get_public_config on a candidate root, through the no-login AJAX endpoint the mobile
 * app itself asks first → its data ({ wwwroot, enablemobilewebservice, maintenanceenabled, … }).
 * Throws NotMoodleError, WsError (a Moodle exception envelope), WsRedirectError or WsBlockedError.
 */
export async function getPublicConfig(root, { timeoutMs = 10_000 } = {}) {
  const methodname = 'tool_mobile_get_public_config';
  const url = `${root}/lib/ajax/service-nologin.php?info=${methodname}`;
  // Manual, so the caller sees the redirect: a POST fetch follows would arrive as a GET.
  const res = await moodleFetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'User-Agent': APP_USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ index: 0, methodname, args: {} }]),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new WsRedirectError(res.status, redirectTarget(res.headers.get('location'), url));
  }
  const type = res.headers.get('content-type') ?? '';
  if (NO_SUCH_PATH.has(res.status) && !type.includes('json')) {
    throw new NotMoodleError(`HTTP ${res.status}`);
  }
  const body = await jsonOrBlocked(res).catch((e) => {
    if (e instanceof SyntaxError) throw new NotMoodleError('unparseable JSON');
    throw e;
  });
  // Per call: [{ error:false, data }] or [{ error:true, exception }]; a failure before any call
  // (bad request, site-level refusal) is one bare { error, errorcode } object.
  const [first] = Array.isArray(body) ? body : [];
  if (first?.error === false && first.data && typeof first.data === 'object') return first.data;
  const exception = first?.error === true ? first.exception : body;
  if (exception && typeof exception === 'object' && typeof exception.errorcode === 'string') {
    throw new WsError(exception.errorcode, exception.message);
  }
  throw new NotMoodleError('JSON, not a Moodle envelope');
}

/** core_webservice_get_site_info → parsed JSON (identity, functions, downloadfiles, release). */
export function getSiteInfo(site, token) {
  return callWs(site, token, 'core_webservice_get_site_info');
}

/** core_course_get_contents(courseId) → the sections array. Throws WsError on a WS exception. */
export function getCourseContents(site, token, courseId) {
  return callWs(site, token, 'core_course_get_contents', { courseid: courseId });
}

// Mint a one-shot no-MFA browser login; rate-limited (~1/user/6 min) and IP-bound. POST only:
// Moodle rejects the privatetoken in a query string (invalidprivatetoken). See docs/MOODLE.md.
/** @returns {Promise<{ key: string, autologinurl: string, warnings: unknown[] }>} */
export function getAutologinKey(site, wstoken, privatetoken) {
  return callWs(site, wstoken, 'tool_mobile_get_autologin_key', { privatetoken }, { post: true });
}

// Pluginfile authenticates by a query-string token. Set via the URL API: fileurl may already
// carry ?forcedownload=1, and concatenating ?token= would break it.
export function pluginfileUrl(fileurl, token) {
  const u = new URL(fileurl);
  u.searchParams.set('token', token);
  return u.toString();
}

// Why a pluginfile answer is not the file, or null when it is: a dead token and a bot challenge
// both answer HTTP 200, and either would be saved as the PDF. See docs/MOODLE.md.
async function pluginfileFault(res, url) {
  if (res.status >= 300 && res.status < 400)
    return new WsBlockedError(`pluginfile: HTTP ${res.status} redirect`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html'))
    return new WsBlockedError(`pluginfile: HTTP ${res.status}, ${type}`);
  if (!type.includes('application/json')) return null;
  const body = await res.json().catch(() => null);
  if (body?.errorcode) return new WsError(body.errorcode, body.message);
  return new CodedError(
    'moodle_file_unreadable',
    { url },
    `pluginfile served JSON, not a file: ${url}`,
  );
}

// The file's full size from a ranged answer's Content-Range, else a whole answer's Content-Length.
function totalSize(res) {
  const range = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
  if (range) return Number(range[1]);
  const len = res.status === 200 ? res.headers.get('content-length') : null;
  return len ? Number(len) : null;
}

// Preflight a tokened pluginfile URL — the last point to report a dead token or a challenge before
// server/ fetches it. → the file's size in bytes, or null when the answer did not say.
export async function assertPluginfileReadable(url) {
  const res = await moodleFetch(url, {
    headers: { Range: 'bytes=0-0', 'User-Agent': APP_USER_AGENT },
  });
  const fault = await pluginfileFault(res, url);
  await res.body?.cancel().catch(() => {});
  if (fault) throw fault;
  return totalSize(res);
}

// Open a tokened pluginfile URL for streaming, `range` passed through → the Response, its body
// unread. Throws as assertPluginfileReadable does when the answer is not the file.
export async function openPluginfile(url, { range, signal } = {}) {
  const headers = { 'User-Agent': APP_USER_AGENT };
  if (range) headers.Range = range;
  const res = await moodleFetch(url, { headers, signal });
  const fault = await pluginfileFault(res, url);
  if (fault) {
    await res.body?.cancel().catch(() => {});
    throw fault;
  }
  return res;
}

// Captured headers never replayed to the host: a range or validator would cut the body at the wrong
// offset, and the rest are per-connection.
const UNREPLAYED = new Set([
  'range',
  'if-range',
  'if-none-match',
  'if-modified-since',
  'host',
  'content-length',
]);

// Open a non-pluginfile file on the Moodle host for streaming — a media link, a videostream capture —
// with its captured `[{name, value}]` headers (cookies included) and `range` → the Response, body
// unread. An HTML answer where a file was due is the bot challenge.
export async function openMoodleFile(url, { headers = [], range, signal } = {}) {
  const sent = {};
  for (const { name, value } of headers) {
    if (!name.startsWith(':') && !UNREPLAYED.has(name.toLowerCase())) sent[name] = value;
  }
  if (range) sent.Range = range;
  const res = await moodleFetch(url, { headers: sent, signal });
  const type = res.headers.get('content-type') ?? '';
  if (res.ok && type.includes('text/html')) {
    await res.body?.cancel().catch(() => {});
    throw new WsBlockedError(`HTTP ${res.status}, ${type}`);
  }
  return res;
}

// Parse the numeric course id from a Moodle course URL (…/course/view.php?id=109063).
// Returned as a string to match the WS &courseid= usage.
export function courseIdFrom(courseUrl) {
  const id = new URL(courseUrl).searchParams.get('id');
  if (!id || !/^\d+$/.test(id))
    throw new CodedError(
      'course_url_no_id',
      { url: courseUrl },
      `no numeric course id in URL: ${courseUrl}`,
    );
  return id;
}
