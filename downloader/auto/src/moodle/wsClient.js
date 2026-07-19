// Thin fetch wrapper over Moodle's Web-Services REST API (webservice/rest/server.php).
// Stateless: a wstoken authenticates every call — no browser, no cookies. Protocol
// reference: docs/MOODLE.md.

// Default Moodle site; kept a parameter (not hardcoded in URL building) so callers can inject.
export const DEFAULT_SITE = 'https://lemida.biu.ac.il';

/** A Moodle WS exception body ({ exception, errorcode, message }) surfaced as an Error. */
export class WsError extends Error {
  constructor(errorcode, message) {
    super(message || errorcode);
    this.name = 'WsError';
    this.errorcode = errorcode;
  }
}

// Moodle answers a dead/expired token with HTTP 200 + an exception body, not a 401.
// The signal is the errorcode, so key on it rather than the message text.
const INVALID_TOKEN_CODES = new Set(['invalidtoken', 'accessexception']);

/** @returns {boolean} true when a thrown WsError is Moodle's invalid/expired-token signal. */
export function invalidToken(err) {
  return err instanceof WsError && INVALID_TOKEN_CODES.has(err.errorcode);
}

// Our token is minted through the app's own launch.php (service=moodle_mobile_app), and Moodle's
// core_useragent::is_moodle_app() substring-matches `MoodleMobile` in the UA to decide whether a
// caller really is the app.
const APP_USER_AGENT = 'MoodleMobile 4.4.0 (44000)';

// One WS call: build the URL (?wstoken=…&moodlewsrestformat=json&wsfunction=… + extra
// params), fetch, parse JSON. With `post`, the extra params move to a form-encoded body
// instead (the three control params stay in the query). A JSON body with `.exception` is
// Moodle's error shape (HTTP is still 200) → throw a WsError so callers can inspect it.
async function callWs(token, fn, params = {}, { site = DEFAULT_SITE, post = false } = {}) {
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

  const res = await fetch(url, init);
  const body = await res.json();
  if (body && body.exception) throw new WsError(body.errorcode, body.message);
  return body;
}

/** core_webservice_get_site_info → parsed JSON (identity, functions, downloadfiles, release). */
export function getSiteInfo(token, { site = DEFAULT_SITE } = {}) {
  return callWs(token, 'core_webservice_get_site_info', {}, { site });
}

/** core_course_get_contents(courseId) → the sections array. Throws WsError on a WS exception. */
export function getCourseContents(token, courseId, { site = DEFAULT_SITE } = {}) {
  return callWs(token, 'core_course_get_contents', { courseid: courseId }, { site });
}

// tool_mobile_get_autologin_key mints a one-shot no-MFA browser login. It's authenticated
// by the wstoken (like every WS call) and takes the privatetoken as a parameter — they're
// two distinct secrets from the launch payload. Rate-limited (~1/user/6 min) and IP-bound.
// Moodle rejects the long-lived privatetoken in a query string (it would land in access logs):
// GET -> {errorcode:'invalidprivatetoken'}; only a form-encoded POST body is accepted.
/** @returns {Promise<{ key: string, autologinurl: string, warnings: unknown[] }>} */
export function getAutologinKey(wstoken, privatetoken, { site = DEFAULT_SITE } = {}) {
  return callWs(wstoken, 'tool_mobile_get_autologin_key', { privatetoken }, { site, post: true });
}

// WS pluginfile auth = token in the query string. fileurl may already carry a query
// (e.g. ?forcedownload=1), so add token via the URL API — string-concatenating ?token=
// would produce a broken double-query. Pure function, no fetch.
export function pluginfileUrl(fileurl, token) {
  const u = new URL(fileurl);
  u.searchParams.set('token', token);
  return u.toString();
}

// Parse the numeric course id from a Moodle course URL (…/course/view.php?id=109063).
// Returned as a string to match the WS &courseid= usage.
export function courseIdFrom(courseUrl) {
  const id = new URL(courseUrl).searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) throw new Error(`no numeric course id in URL: ${courseUrl}`);
  return id;
}
