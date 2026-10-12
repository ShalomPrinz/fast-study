// Thin fetch wrapper over Moodle's Web-Services REST API; a wstoken authenticates every call —
// no cookies. Protocol reference: docs/MOODLE.md.
import { CodedError } from '../lib/errors.js';
import { enterMoodle } from './gate.js';
import { challengeRoute, openChallenge } from './challenge.js';
import { currentSite, underSite } from './site.js';

// An answer shaped like the bot wall: a redirect, or a page where a WS body or a file was due.
function wallShaped(res) {
  return (
    (res.status >= 300 && res.status < 400) ||
    (res.headers.get('content-type') ?? '').includes('text/html')
  );
}

// Every Moodle request: the gate, then Node's fetch or the challenge window's page, resending a Node
// wall through a window that opens 'ready' (docs/MOODLE.md § Bot protection; `route`/`reopen` there).
async function moodleFetch(url, init, { route = true, reopen = route, label = '' } = {}) {
  await enterMoodle(String(url).split('?')[0]);
  const window = route ? challengeRoute(url) : null;
  if (window) return windowFetch(window, url, init);
  const res = await fetch(url, init);
  ROUTE.set(res, 'node');
  const site = currentSite();
  if (!reopen || !wallShaped(res) || !site || !underSite(String(url), site)) return res;
  await res.body?.cancel().catch(() => {});
  const err = new WsBlockedError(`${label}${wallDetail(res)}`, ROUTED);
  const state = await openChallenge(site);
  const reopened = state === 'ready' ? challengeRoute(url) : null;
  if (reopened) return windowFetch(reopened, url, init);
  err.params = { ...err.params, challengeWindow: state };
  throw err;
}

async function windowFetch(window, url, init) {
  // Still on the captcha: nothing is sent, and the 503 tells the user to solve it first.
  if (!window.onSite())
    throw new WsBlockedError('the challenge window is still on the captcha', ROUTED);
  // Closed mid-call (head or body): block mode is over, so the user's repeat goes out on Node.
  const closed = () => new WsBlockedError('the challenge window was closed');
  let res;
  try {
    res = await window.fetch(url, init, { lost: closed });
  } catch (err) {
    if (window.gone(err)) throw closed();
    throw err;
  }
  ROUTE.set(res, 'window');
  if (!wallShaped(res)) await window.passed();
  return res;
}

// Which transport answered each Response ('node' | 'window'), for the WsError log line.
const ROUTE = new WeakMap();

const wallDetail = (res) =>
  res.status >= 300 && res.status < 400
    ? `HTTP ${res.status} redirect`
    : `HTTP ${res.status}, ${res.headers.get('content-type') || 'no content-type'}`;

/** A Moodle WS exception body ({ exception, errorcode, message }) surfaced as an Error. */
export class WsError extends CodedError {
  constructor(errorcode, message) {
    // errorcode in the message too: Sentry gets the message, never `params`, and Moodle's is localized.
    super(
      'moodle_ws_error',
      { errorcode, detail: message ?? null },
      message ? `${message} (${errorcode})` : errorcode,
    );
    this.name = 'WsError';
    this.errorcode = errorcode;
  }
}

// Build the WsError for a Moodle exception body `res` answered, logging its errorcode, debuginfo and
// route. `secrets` are blanked from debuginfo, which can echo a rejected param's value verbatim.
function wsFault(body, res, label, secrets = []) {
  const err = new WsError(body.errorcode, body.message);
  let debug = typeof body.debuginfo === 'string' ? body.debuginfo : '';
  // A short value would blank unrelated text; real tokens are 32 and 64 chars.
  for (const s of secrets)
    if (String(s ?? '').length >= 8) debug = debug.split(String(s)).join('<redacted>');
  console.warn(
    `moodle ${label}: ${body.errorcode} via ${(res && ROUTE.get(res)) ?? 'node'}` +
      (debug ? `, debuginfo: ${debug.slice(0, 500)}` : ''),
  );
  return err;
}

/**
 * The site answered with a bot-protection challenge instead of what was asked for — an HTML
 * page or a redirect where a WS body or a file was due. A site behind a bot manager (BIU's Radware)
 * serves one (HTTP 200, text/html) to a client it reads as automated, so this is a distinct failure
 * from a WS fault and never a JSON parse bug.
 */
export class WsBlockedError extends CodedError {
  // `routed`: thrown by a call the challenge window can carry, so only it turns block mode on.
  constructor(detail, { routed = false } = {}) {
    super(
      'site_blocked',
      { detail },
      `the site is refusing automated requests — it served a bot-protection challenge ` +
        `instead of a valid response (${detail}); wait a few minutes and retry`,
    );
    this.name = 'WsBlockedError';
    this.routed = routed;
  }
}

const ROUTED = { routed: true };

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

// Drop a body nobody will read: a window's page keeps it until read or cancelled (challenge.js).
const discard = (res) => res.body?.cancel().catch(() => {});

// The token is minted as the mobile app's, and Moodle's is_moodle_app() gates app-only functions
// on `MoodleMobile` in the UA.
const APP_USER_AGENT = 'MoodleMobile 4.4.0 (44000)';

// A challenge answers 302 or 200 text/html; parsing either as JSON would only report a
// SyntaxError, hiding the real cause. Check before touching the body.
async function jsonOrBlocked(res) {
  const type = res.headers.get('content-type') ?? '';
  const redirect = res.status >= 300 && res.status < 400;
  if (!redirect && type.includes('json')) return res.json();
  await discard(res);
  if (redirect) throw new WsBlockedError(`HTTP ${res.status} redirect`, ROUTED);
  throw new WsBlockedError(`HTTP ${res.status}, ${type || 'no content-type'}`, ROUTED);
}

// One WS call against `site`. With `post`, the extra params move to a form-encoded body. An `.exception` body (under HTTP 200) throws WsError; a non-JSON answer is the
// challenge → WsBlockedError.
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

  const res = await moodleFetch(url, init);
  const body = await jsonOrBlocked(res);
  if (body && body.exception) throw wsFault(body, res, fn, [token]);
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
    super(`HTTP ${status} redirect`, ROUTED);
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
  const res = await moodleFetch(
    url,
    {
      method: 'POST',
      redirect: 'manual',
      headers: { 'User-Agent': APP_USER_AGENT, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ index: 0, methodname, args: {} }]),
      signal: AbortSignal.timeout(timeoutMs),
    },
    { reopen: false },
  );
  if (res.status >= 300 && res.status < 400) {
    await discard(res);
    throw new WsRedirectError(res.status, redirectTarget(res.headers.get('location'), url));
  }
  const type = res.headers.get('content-type') ?? '';
  if (NO_SUCH_PATH.has(res.status) && !type.includes('json')) {
    await discard(res);
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
    throw wsFault(exception, res, methodname);
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

/** core_enrol_get_users_courses(userid) → the user's enrolled courses (id, fullname, visible, enddate, …). */
export function getUserCourses(site, token, userid) {
  return callWs(site, token, 'core_enrol_get_users_courses', { userid });
}

/** core_course_get_course_module(cmid) → { cm, warnings }; `cm.course` is the module's course id. */
export function getCourseModule(site, token, cmid) {
  return callWs(site, token, 'core_course_get_course_module', { cmid });
}

// What the Moodle app adds to every site-plugin call (moodleapp siteplugins.ts addDefaultArgs).
const APP_ARGS = {
  appid: 'com.moodle.moodlemobile',
  appversioncode: 45000,
  appversionname: '4.5.0',
  applang: 'he',
  appcustomurlscheme: 'moodlemobile',
  appisdesktop: 0,
  appismobile: 1,
  appiswide: 0,
  appplatform: 'android',
};

/**
 * mod_videostream's Moodle-app handler through tool_mobile_get_content → { templates: [{ id, html }], … },
 * the page the app renders, its `<video>` naming the .mp4. Sent exactly as the app does: a POST with
 * the `moodlewssetting*` flags, `userid` among the args and never `id` — less crashes the handler.
 * See docs/MOODLE.md § Videostream.
 */
export function getVideostreamContent(site, token, { courseid, cmid, userid }) {
  const args = { courseid, cmid, userid, ...APP_ARGS };
  const params = {
    moodlewssettingfilter: 'true',
    moodlewssettingfileurl: 'true',
    moodlewssettinglang: 'he',
    component: 'mod_videostream',
    method: 'view_videostream',
  };
  Object.entries(args).forEach(([name, value], i) => {
    params[`args[${i}][name]`] = name;
    params[`args[${i}][value]`] = value;
  });
  return callWs(site, token, 'tool_mobile_get_content', params, { post: true });
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
    return new WsBlockedError(`pluginfile: HTTP ${res.status} redirect`, ROUTED);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html'))
    return new WsBlockedError(`pluginfile: HTTP ${res.status}, ${type}`, ROUTED);
  if (!type.includes('application/json')) return null;
  const body = await res.json().catch(() => null);
  if (body?.errorcode)
    return wsFault(body, res, 'pluginfile', [new URL(url).searchParams.get('token')]);
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
  const res = await moodleFetch(
    url,
    { headers: { Range: 'bytes=0-0', 'User-Agent': APP_USER_AGENT } },
    { label: 'pluginfile: ' },
  );
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
  const res = await moodleFetch(url, { headers, signal }, { label: 'pluginfile: ' });
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

// Open a non-pluginfile file on the Moodle host for streaming — a media link —
// with its captured `[{name, value}]` headers (cookies included) and `range` → the Response, body
// unread. An HTML answer where a file was due is the bot challenge.
export async function openMoodleFile(url, { headers = [], range, signal } = {}) {
  const sent = {};
  for (const { name, value } of headers) {
    if (!name.startsWith(':') && !UNREPLAYED.has(name.toLowerCase())) sent[name] = value;
  }
  if (range) sent.Range = range;
  const res = await moodleFetch(url, { headers: sent, signal }, { route: false });
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
