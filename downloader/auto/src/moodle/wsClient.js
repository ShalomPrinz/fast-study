// Thin fetch wrapper over Moodle's Web-Services REST API; a wstoken authenticates every call —
// no browser, no cookies. Protocol reference: docs/MOODLE.md.
import { CodedError } from '../lib/errors.js';

// Default Moodle site; kept a parameter (not hardcoded in URL building) so callers can inject.
export const DEFAULT_SITE = 'https://lemida.biu.ac.il';

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
 * page or a redirect where a WS body or a file was due. `lemida.biu.ac.il` sits behind Radware
 * Bot Manager, which serves one (HTTP 200, text/html) to a client it reads as automated, so this
 * is a distinct failure from a WS fault and never a JSON parse bug.
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

// One WS call. With `post`, the extra params move to a form-encoded body. An `.exception` body
// (under HTTP 200) throws WsError; a non-JSON answer is the challenge → WsBlockedError.
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
  // A challenge answers 302 or 200 text/html; parsing either as JSON would only report a
  // SyntaxError, hiding the real cause. Check before touching the body.
  if (res.status >= 300 && res.status < 400)
    throw new WsBlockedError(`HTTP ${res.status} redirect`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json'))
    throw new WsBlockedError(`HTTP ${res.status}, ${type || 'no content-type'}`);
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

// Mint a one-shot no-MFA browser login; rate-limited (~1/user/6 min) and IP-bound. POST only:
// Moodle rejects the privatetoken in a query string (invalidprivatetoken). See docs/MOODLE.md.
/** @returns {Promise<{ key: string, autologinurl: string, warnings: unknown[] }>} */
export function getAutologinKey(wstoken, privatetoken, { site = DEFAULT_SITE } = {}) {
  return callWs(wstoken, 'tool_mobile_get_autologin_key', { privatetoken }, { site, post: true });
}

// Pluginfile authenticates by a query-string token. Set via the URL API: fileurl may already
// carry ?forcedownload=1, and concatenating ?token= would break it.
export function pluginfileUrl(fileurl, token) {
  const u = new URL(fileurl);
  u.searchParams.set('token', token);
  return u.toString();
}

// Preflight a tokened pluginfile URL: a dead token and a bot challenge both answer HTTP 200, and
// server/'s job would save either as the PDF. The last point to report them. See docs/MOODLE.md.
export async function assertPluginfileReadable(url) {
  const res = await fetch(url, {
    headers: { Range: 'bytes=0-0', 'User-Agent': APP_USER_AGENT },
  });
  if (res.status >= 300 && res.status < 400)
    throw new WsBlockedError(`pluginfile: HTTP ${res.status} redirect`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html'))
    throw new WsBlockedError(`pluginfile: HTTP ${res.status}, ${type}`);
  if (!type.includes('application/json')) return;
  const body = await res.json().catch(() => null);
  if (body?.errorcode) throw new WsError(body.errorcode, body.message);
  throw new CodedError(
    'moodle_file_unreadable',
    { url },
    `pluginfile served JSON, not a file: ${url}`,
  );
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
