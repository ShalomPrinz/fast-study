import {
  siteAuth,
  siteAuthFor,
  setSite,
  authEvents,
  authState,
  resolveExtractorForRecording,
  reachesMoodle,
} from '../core/registry.js';
import { normalizeSite, currentSite } from '../moodle/site.js';
import {
  reportBlock,
  openChallenge,
  challengeState,
  challengeEvents,
} from '../moodle/challenge.js';
import { probeSite } from '../moodle/probe.js';
import { reportUnsupportedSite } from '../../siteReport.js';
import { setReporting } from '@faststudy/sentry';
import { getSession, closeAllSessions, browserClosed } from '../browser/browserSession.js';
import { resolveBrowserChannel } from '../browser/browserChannel.js';
import { loadStealthChromium } from '../browser/zoomBrowser.js';
import {
  listRecordings,
  toCourses,
  resolveRecording,
  resolveMoodleFile,
  resolveVideostream,
  resolveYtDlp,
  resolveDriveFile,
  resolveDirectUrl,
  resolvePastedLink,
} from '../core/core.js';
import { driveFileId } from '../extractors/GoogleDriveExtractor.js';
import { getProbedMedia } from '../core/probeCache.js';
import { probeKeyForUrl } from '../lib/probeUrl.js';
import { encodeRef, decodeRef } from '../lib/ref.js';
import {
  CodedError,
  UnsupportedError,
  PasscodeError,
  failureOf,
  unreachable,
} from '../lib/errors.js';
import * as passcodes from '../lib/passcodes.js';
import {
  courseIdFrom,
  getCourseContents,
  getUserCourses,
  invalidToken,
  WsError,
  blocked,
  openPluginfile,
  openMoodleFile,
  pluginfileUrl,
} from '../moodle/wsClient.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { moodleGate, MoodleBusyError, WAIT_HEADER } from '../moodle/gate.js';
import { fileById } from '../moodle/files.js';

// Strategies whose row type is only knowable from a download-time probe — the WS payload names
// no file for an off-site link, so 'unknown' is the honest stamp until one runs.
const PROBED = new Set(['google-drive', 'direct-url']);

// Which file a row lands as, decided with no network call.
function mediaOf(recording) {
  if (recording.strategy === 'moodle-file') return 'material';
  return PROBED.has(recording.strategy) ? 'unknown' : 'video';
}

// The cache key a row's own strategy probes under, or null for a strategy that never probes.
function probeKeyOf(recording) {
  if (recording.strategy === 'google-drive') return driveFileId(recording.pageUrl);
  if (recording.strategy === 'direct-url') return probeKeyForUrl(recording.pageUrl);
  return null;
}

// What an 'unknown' row was probed as this session, or undefined when never probed; a cached
// null media (either unusable flavour) surfaces as 'unsupported'.
function resolvedMediaOf(recording) {
  const key = probeKeyOf(recording);
  if (!key) return undefined;
  const media = getProbedMedia(key);
  if (media === undefined) return undefined;
  return media ?? 'unsupported';
}

// Mechanism-agnostic item; the mechanism hides inside the opaque `ref`. An unexpanded playlist
// (pageUrl, no url) is expandable. Field meanings in docs/BROWSING.md.
function toItem(recording) {
  const resolvedMedia = resolvedMediaOf(recording);
  return {
    ref: encodeRef(recording),
    title: recording.title,
    kind: recording.kind,
    media: mediaOf(recording),
    ...(resolvedMedia ? { resolvedMedia } : {}),
    likelyRecording: recording.likelyRecording !== false,
    moodle: reachesMoodle(recording),
    expandable: recording.strategy === 'youtube-playlist' && !recording.url,
    section: recording.section ?? '',
  };
}

// Thin wrapper over Express's res.status().json() so the handler call sites stay
// send(res, status, body) — no manual writeHead / JSON.stringify.
function send(res, status, body) {
  res.status(status).json(body);
}

// Lightweight request logging — one line in, one out; no DOM / state / secrets.
function logReq(method, path, detail) {
  console.log(`→ ${method} ${path}${detail ? `  ${detail}` : ''}`);
}
function logResult(path, msg) {
  console.log(`↳ ${path} → ${msg}`);
}

// A request our own SPA, popup or peer shaped wrongly: today's English plus the offending field,
// so every body on the wire has the same shape (repo-root `docs/ERROR-CODES.md`).
function invalid(field, error) {
  return { error, code: 'invalid_request', params: { field } };
}

// Distinct "session expired → steer the user to Reconnect" signal.
function sendReconnect(res) {
  send(res, 401, { status: 'reconnect', code: 'moodle_reconnect_required', params: {} });
}

// Distinct "this item can't be expanded/downloaded" signal (e.g. a `url` module
// redirecting off-YouTube) so the page shows the specific reason. Relays the thrower's code —
// what is unsupported differs per source, and only the throw site knows which.
export function sendUnsupported(res, err) {
  send(res, 422, {
    status: 'unsupported',
    message: err.message,
    code: err.code,
    params: err.params,
  });
}

// Distinct "the site served a bot-protection challenge" signal. 503: the site is refusing us for
// now; nothing about the request is wrong. Block mode goes on first, so `params.challengeWindow`
// says whether a captcha waits on screen (docs/MOODLE.md § Bot protection).
async function sendBlocked(res, err) {
  await reportBlock(err, currentSite());
  send(res, 503, { status: 'blocked', message: err.message, code: err.code, params: err.params });
}

// Distinct "the upstream host could not be reached" signal (a refused, timed-out or unresolved
// connection): 503 with no `status`, so the frontend never reads it as a bot wall.
function sendUnreachable(res, route, err) {
  logResult(route, `unreachable (503): ${err.message}`);
  send(res, 503, failureOf(err));
}

// Distinct "the zoom passcode gate couldn't be cleared" signal so the page can prompt
// for a passcode (reason 'missing') or flag a wrong one (reason 'incorrect') and retry. The gate
// knows neither course nor lecture, so the route's own are what reach the params.
export function sendPasscode(res, err, { course, name }) {
  send(res, 409, {
    status: 'passcode',
    reason: err.reason,
    course,
    name,
    code: err.code,
    params: { reason: err.reason, course, name },
  });
}

// Distinct "another Moodle request holds the lock" signal (docs/GATE.md): nothing was sent to the
// site; retry once `moodleBusy` on /auth/events reads false.
function sendBusy(res, err) {
  send(res, 429, { status: 'busy', error: err.message, code: err.code, params: err.params });
}

/**
 * Run a route as one gated request (docs/GATE.md): its first Moodle call takes the lock. A caller
 * sending WAIT_HEADER: 1 (server/'s own calls) queues for it; any other is refused 429 moodle_busy.
 * A caller that hangs up leaves the queue.
 */
function gated(route, handler) {
  return async (req, res) => {
    const gone = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) gone.abort();
    });
    const wait = req.headers?.[WAIT_HEADER.toLowerCase()] === '1';
    try {
      await moodleGate.run({ wait, signal: gone.signal }, () => handler(req, res));
    } catch (e) {
      if (e instanceof MoodleBusyError && !res.headersSent) {
        logResult(route, 'busy (429)');
        return sendBusy(res, e);
      }
      if (gone.signal.aborted) return; // the caller is gone; nobody is left to answer
      throw e;
    }
  };
}

// Reject an empty or multi-segment name — the traversal half of server/'s
// validate.js::storedName, which owns the full canonicalization.
function isSafeName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..'
  );
}

// The configured site's auth, or null after answering 409 moodle_site_not_configured /
// 400 course_url_unsupported_site — the two ways a request can name no usable site.
function siteOr(res, url) {
  try {
    return url === undefined ? siteAuth() : siteAuthFor(url);
  } catch (e) {
    const status = e.code === 'moodle_site_not_configured' ? 409 : 400;
    send(res, status, failureOf(e));
    return null;
  }
}

// ── Site endpoints ──────────────────────────────────────────────────────────

// Apply settings to the running process; omitted fields are left alone. `moodle_site` is stored
// as given (the frontend saves the probe's canonical site); a different one ends a pending login
// and deletes nothing — the token is replaced only by a Connect on the new site.
export async function handleConfig(req, res) {
  const body = req.body ?? {};
  logReq('POST', '/config', Object.keys(body).join(','));
  // Checked before anything applies, so a bad flag never leaves a half-applied site change.
  if ('error_reports' in body && typeof body.error_reports !== 'boolean') {
    return send(res, 400, invalid('error_reports', 'error_reports must be a boolean'));
  }
  const applied = [];
  if ('moodle_site' in body) {
    const raw = body.moodle_site;
    // Blank clears the site, as a blank key does on the backend's /config.
    const site = raw ? normalizeSite(raw) : null;
    if ((raw !== null && typeof raw !== 'string') || (raw && !site)) {
      return send(res, 400, invalid('moodle_site', 'moodle_site must be an http(s) URL or blank'));
    }
    if (await setSite(site)) {
      logResult('/config', `moodle site → ${site ?? '(none)'}`);
    }
    applied.push('moodle_site');
  }
  if ('error_reports' in body) {
    // Live: the gated transport and scrub read this flag on every send, so no re-init.
    setReporting(body.error_reports);
    applied.push('error_reports');
  }
  send(res, 200, { status: 'ok', applied });
}

// The pre-login check (docs/MOODLE.md § Checking a site): always 200, the verdict is the answer.
export const handleSiteProbe = gated('/site/probe', async (req, res) => {
  const { url } = req.body ?? {};
  logReq('POST', '/site/probe', url);
  const result = typeof url === 'string' ? await probeSite(url) : null;
  if (!result) return send(res, 400, invalid('url', 'a site URL is required'));
  // A wall on the probe turns block mode on for the site it was asking, as any 503 does.
  if (result.status === 'unverified' && result.params.detail === 'site_blocked') {
    result.params.challengeWindow = await openChallenge(result.site);
  }
  logResult(
    '/site/probe',
    `${result.status}${result.params?.reason ? ` (${result.params.reason})` : ''}`,
  );
  // Maintenance is a Moodle that will be back, not one we cannot serve, so it is not reported.
  if (result.status === 'unsupported' && result.params.reason !== 'maintenance') {
    reportUnsupportedSite({ site: result.site, stage: 'probe', reason: result.params.reason });
  }
  send(res, 200, result);
});

// ── Auth endpoints ──────────────────────────────────────────────────────────

export function handleAuthStatus(req, res) {
  const found = siteOr(res);
  if (found) send(res, 200, found.auth.status());
}

// SSE: the auth state now, then again on every change. `secret` rides the query string because
// EventSource cannot set a header; requireSecret already honours it.
export function handleAuthEvents(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const push = () => {
    const frame = { ...authState(), moodleBusy: moodleGate.busy(), challenge: challengeState() };
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
  };
  authEvents.on('change', push);
  moodleGate.on('change', push);
  challengeEvents.on('change', push);
  req.on('close', () => {
    authEvents.off('change', push);
    moodleGate.off('change', push);
    challengeEvents.off('change', push);
  });
  push();
}

// The login outlives this request: connect() takes a lease on the lock that its background run
// releases when the login ends, however it ends.
export const handleAuthConnect = gated('/auth/connect', async (req, res) => {
  logReq('POST', '/auth/connect');
  const found = siteOr(res);
  if (!found) return;
  // The token module builds its own launch.php URL and drives the login itself from here on.
  await found.auth.connect();
  send(res, 200, { status: 'pending' });
});

// The verified stored token, or null after answering: 401 reconnect (none, or a dead one), 422 for
// a refused site, 503 for a bot-protection block. One path for every WS caller. `answerUnreachable`:
// a first-use verify that cannot reach the site is 503 site_unreachable here instead of a rethrow.
async function tokenOr(res, auth, route, { answerUnreachable = false } = {}) {
  try {
    const tok = await auth.verifiedToken();
    if (tok) return tok;
    logResult(route, 'reconnect (401)');
    sendReconnect(res);
  } catch (e) {
    if (invalidToken(e)) {
      logResult(route, 'reconnect (401)');
      sendReconnect(res);
    } else if (e instanceof UnsupportedError) {
      logResult(route, `unsupported (422): ${e.message}`);
      sendUnsupported(res, e);
    } else if (blocked(e)) {
      logResult(route, `blocked (503): ${e.message}`);
      await sendBlocked(res, e);
    } else if (answerUnreachable && unreachable(e)) {
      sendUnreachable(res, route, unreachable(e));
    } else throw e;
  }
  return null;
}

export const handleAuthComplete = gated('/auth/complete', async (req, res) => {
  logReq('POST', '/auth/complete');
  const found = siteOr(res);
  if (!found) return;
  try {
    await found.auth.complete();
  } catch (e) {
    if (e instanceof UnsupportedError) {
      logResult('/auth/complete', `unsupported (422): ${e.message}`);
      return sendUnsupported(res, e);
    }
    if (invalidToken(e)) {
      logResult('/auth/complete', 'reconnect (401)');
      return sendReconnect(res);
    }
    if (blocked(e)) {
      logResult('/auth/complete', `blocked (503): ${e.message}`);
      return sendBlocked(res, e);
    }
    throw e;
  }
  send(res, 200, { connected: true });
});

export async function handleAuthDisconnect(req, res) {
  logReq('POST', '/auth/disconnect');
  const found = siteOr(res);
  if (!found) return;
  await found.auth.disconnect();
  send(res, 200, { connected: false });
}

// ── Prerequisite endpoints ──────────────────────────────────────────────────

// Is Chrome or Edge installed? Always 200 — "no browser" is an answer, not a failure — and a
// negative is never cached, so re-checking after an install needs no restart (docs/SESSIONS.md).
export async function handleBrowserPrereq(req, res) {
  logReq('GET', '/prereqs/browser');
  try {
    const { channel, browser } = await resolveBrowserChannel();
    logResult('/prereqs/browser', `available (${channel})`);
    return send(res, 200, {
      available: true,
      channel,
      browser,
      detail: `${browser} is installed.`,
    });
  } catch (e) {
    logResult('/prereqs/browser', `unavailable: ${e.message}`);
    const { code, params } = failureOf(e);
    // `available:false` is an answer, not a failure — but it carries the same code the 500 backstop
    // would, so a consumer reads one code for "no browser" whichever response it came from.
    return send(res, 200, {
      available: false,
      channel: null,
      browser: null,
      detail: e.message,
      code,
      params,
    });
  }
}

// Starts the Playwright and stealth loads the real launch paths share, answering before they finish;
// never launches a browser. A failed load is only logged, and the next real use retries it.
export function handleWarmup(req, res) {
  logReq('POST', '/warmup');
  Promise.all([import('playwright'), loadStealthChromium()]).then(
    () => logResult('/warmup', 'browser modules loaded'),
    (e) => logResult('/warmup', `load failed: ${e.message}`),
  );
  send(res, 202, { status: 'warming' });
}

// ── Browsing endpoints ──────────────────────────────────────────────────────

// Answer a failed WS call on a course: a dead token → mark expired + 401 reconnect, a wall → 503,
// a network failure → 503 site_unreachable, any other Moodle exception (with `courseUrl`) → 422 course_not_accessible. → whether it answered.
async function sentWsFailure(res, e, auth, route, courseUrl) {
  if (invalidToken(e)) {
    auth.markExpired();
    logResult(route, 'reconnect (401)');
    sendReconnect(res);
    return true;
  }
  if (blocked(e)) {
    logResult(route, `blocked (503): ${e.message}`);
    await sendBlocked(res, e);
    return true;
  }
  const down = unreachable(e);
  if (down) {
    sendUnreachable(res, route, down);
    return true;
  }
  if (courseUrl !== undefined && e instanceof WsError) {
    logResult(route, `not accessible (422): ${e.message}`);
    const err = new CodedError(
      'course_not_accessible',
      { url: courseUrl, detail: e.params.detail },
      `${courseUrl} could not be read: ${e.message}`,
    );
    send(res, 422, failureOf(err));
    return true;
  }
  return false;
}

// The connected account's enrolled courses — one WS call, or none when the login found the
// function missing from the token's service (docs/MOODLE.md § The course picker).
export const handleCourses = gated('/courses', async (req, res) => {
  logReq('GET', '/courses');
  const found = siteOr(res);
  if (!found) return;
  const { site, auth } = found;
  const stored = await tokenOr(res, auth, '/courses', { answerUnreachable: true });
  if (!stored) return;
  if (stored.coursesAvailable !== true) {
    logResult('/courses', 'unavailable');
    return send(res, 200, { available: false });
  }
  let courses;
  try {
    courses = await getUserCourses(site, stored.wstoken, stored.userid);
  } catch (e) {
    if (await sentWsFailure(res, e, auth, '/courses')) return;
    throw e;
  }
  const rows = toCourses(courses, site);
  logResult('/courses', `${rows.length} courses`);
  send(res, 200, { available: true, courses: rows });
});

// A course page on the configured site, strictly: `{site}/course/view.php?id=<digits>`, nothing else.
function isCoursePage(url, site) {
  const u = new URL(url);
  const id = u.searchParams.get('id');
  return (
    u.pathname === `${new URL(site).pathname.replace(/\/+$/, '')}/course/view.php` &&
    /^\d+$/.test(id ?? '')
  );
}

// Check a pasted course URL before it is saved: strictly a course page, then one contents call.
export const handleCourseCheck = gated('/courses/check', async (req, res) => {
  const { courseUrl } = req.body ?? {};
  logReq('POST', '/courses/check', courseUrl);
  if (typeof courseUrl !== 'string') {
    return send(res, 400, invalid('courseUrl', 'courseUrl required'));
  }
  const notCoursePage = () =>
    send(
      res,
      400,
      failureOf(
        new CodedError(
          'course_url_not_course_page',
          { url: courseUrl },
          `${courseUrl} is not a course page (…/course/view.php?id=N)`,
        ),
      ),
    );
  if (!/^https?:\/\//i.test(courseUrl) || !URL.canParse(courseUrl)) return notCoursePage();
  const found = siteOr(res, courseUrl);
  if (!found) return;
  const { site, auth } = found;
  if (!isCoursePage(courseUrl, site)) return notCoursePage();
  const stored = await tokenOr(res, auth, '/courses/check', { answerUnreachable: true });
  if (!stored) return;
  try {
    await getCourseContents(site, stored.wstoken, new URL(courseUrl).searchParams.get('id'));
  } catch (e) {
    if (await sentWsFailure(res, e, auth, '/courses/check', courseUrl)) return;
    throw e;
  }
  logResult('/courses/check', 'ok');
  send(res, 200, { ok: true });
});

export const handleList = gated('/list', async (req, res) => {
  const { courseUrl } = req.body;
  logReq('POST', '/list', courseUrl);
  if (typeof courseUrl !== 'string' || !/^https?:\/\//.test(courseUrl)) {
    return send(res, 400, invalid('courseUrl', 'valid courseUrl required'));
  }
  const found = siteOr(res, courseUrl);
  if (!found) return;
  const { site, auth } = found;
  const stored = await tokenOr(res, auth, '/list', { answerUnreachable: true });
  if (!stored) return;

  let courseId;
  try {
    courseId = courseIdFrom(courseUrl);
  } catch (e) {
    return send(res, 400, failureOf(e));
  }

  // Stateless WS: no browser needed.
  let sections;
  try {
    sections = await getCourseContents(site, stored.wstoken, courseId);
  } catch (e) {
    if (await sentWsFailure(res, e, auth, '/list', courseUrl)) return;
    throw e;
  }
  const recordings = listRecordings(sections, courseId);
  logResult('/list', `${recordings.length} items`);
  send(res, 200, { items: recordings.map(toItem) });
});

// Resolve ONE expandable item (a YouTube playlist) into its downloadable children by
// running yt-dlp on the direct external URL in the ref — no browser, no auth, never the lock.
export const handleListExpand = gated('/list/expand', async (req, res) => {
  logReq('POST', '/list/expand', '(expanding)');
  const { ref } = req.body;
  const recording = decodeRef(ref);
  const extractor = resolveExtractorForRecording(recording);
  if (!recording?.pageUrl || typeof extractor?.listEntries !== 'function') {
    return send(res, 400, invalid('ref', 'item is not expandable'));
  }
  let entries;
  try {
    entries = await extractor.listEntries(recording);
  } catch (e) {
    if (e instanceof UnsupportedError) {
      logResult('/list/expand', `unsupported (422): ${e.message}`);
      return sendUnsupported(res, e);
    }
    throw e; // other failures fall through to the centralized 500 ("try again")
  }
  // Each entry becomes a concrete, downloadable child (has a direct url → not
  // expandable). The child's ref carries the youtube recording for /resolve.
  const items = entries.map((e) =>
    toItem({
      title: e.title,
      url: e.url,
      kind: recording.kind,
      strategy: recording.strategy,
      section: recording.section,
      // A playlist's children inherit its verdict: a video title says nothing on its own.
      likelyRecording: recording.likelyRecording,
    }),
  );
  logResult('/list/expand', `${items.length} items`);
  send(res, 200, { items });
});

// Symmetric with /list/expand: an unsupported ref on the resolve path surfaces as
// 422, not a 500, and a host it could not reach as 503. Other errors rethrow to the centralized handler.
export const handleResolve = gated('/resolve', async (req, res) => {
  try {
    await resolveItem(req, res);
  } catch (e) {
    if (e instanceof UnsupportedError) {
      logResult('/resolve', `unsupported (422): ${e.message}`);
      return sendUnsupported(res, e);
    }
    if (e instanceof PasscodeError) {
      const { course, name } = req.body;
      logResult('/resolve', `passcode ${e.reason} (409)`);
      return sendPasscode(res, e, { course, name });
    }
    const down = unreachable(e);
    if (down) return sendUnreachable(res, '/resolve', down);
    if (e instanceof CodedError && e.code === 'zoom_browser_closed') {
      logResult('/resolve', 'zoom browser closed (503)');
      return send(res, 503, failureOf(e));
    }
    throw e;
  }
});

// The user closed the zoom window mid-capture: a handled 503 (no `status`), never a 500 — the
// session already forgot that browser, so a retry launches a fresh one. Playwright's text is `detail`.
function zoomBrowserClosed(err) {
  return new CodedError(
    'zoom_browser_closed',
    { detail: err?.message ?? null },
    'the zoom browser window was closed during the capture',
  );
}

// The 400 body for a course/name/kind no target can land under, or null when all three are usable.
function targetError(course, name, kind) {
  if (!isSafeName(course) || !isSafeName(name))
    return invalid(isSafeName(course) ? 'name' : 'course', 'course and name are required');
  if (kind !== 'lecture' && kind !== 'recitation') return invalid('kind', `invalid kind: ${kind}`);
  return null;
}

// A pasted link → one video target. Only a link on the Moodle host is probed (under the lock);
// any other goes straight to yt-dlp, as the manual form always did.
async function resolvePasted(res, { url, course, name, kind }) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url))
    return send(res, 400, invalid('url', 'valid url required'));
  const bad = targetError(course, name, kind);
  if (bad) return send(res, 400, bad);
  const targets = await resolvePastedLink({ url, name });
  logResult('/resolve', `ok (pasted link, ${targets[0].tool})`);
  send(res, 200, { media: 'video', targets });
}

async function resolveItem(req, res) {
  const { ref, url, course, name, kind = 'lecture', only, forceCapture } = req.body;
  // No ref but a url: a link pasted into the manual form (docs/GATE.md § Files).
  if (ref === undefined && url !== undefined) {
    logReq('POST', '/resolve', `${course}/${name} (${kind})`);
    return resolvePasted(res, { url, course, name, kind });
  }
  // The discovery row's ref groups every server/ job spawned from this resolve (incl. a zoom
  // split pair); it is also the key each cap is memoized under in the replay cache.
  const rowRef = typeof ref === 'string' ? ref : null;
  const recording = decodeRef(ref);
  // The row's identity: which module, resolved by which strategy.
  const row = recording && typeof recording === 'object' ? recording : {};
  logReq(
    'POST',
    '/resolve',
    `${course}/${name} (${kind}) ${row.strategy ?? '?'} ${row.pageUrl ?? row.fileurl ?? row.url ?? '-'}`,
  );
  if (!recording || typeof recording !== 'object')
    return send(res, 400, invalid('ref', 'valid ref required'));
  const bad = targetError(course, name, kind);
  if (bad) return send(res, 400, bad);

  // only = act on just this one (course,name,kind) target (a no-op for the single-target
  // browserless strategies); forceCapture = bypass the replay and probe caches
  const opts = { only: only === true, forceCapture: forceCapture === true };

  // moodle-file needs no browser either: the ref carries the Moodle fileurl, and the WS
  // token (query-string auth for pluginfile) makes it a plain fetch for server/.
  if (recording.strategy === 'moodle-file') {
    const found = siteOr(res, recording.fileurl);
    if (!found) return;
    const { auth } = found;
    const stored = await tokenOr(res, auth, '/resolve');
    if (!stored) return;
    let targets;
    try {
      targets = await resolveMoodleFile({
        recording,
        course,
        name,
        kind,
        wstoken: stored.wstoken,
        ref: rowRef,
        forceCapture: opts.forceCapture,
      });
    } catch (e) {
      if (invalidToken(e)) {
        auth.markExpired();
        logResult('/resolve', 'reconnect (401)');
        return sendReconnect(res);
      }
      if (blocked(e)) {
        logResult('/resolve', `blocked (503): ${e.message}`);
        return sendBlocked(res, e);
      }
      throw e;
    }
    logResult('/resolve', `ok (${targets.length} target, material)`);
    return send(res, 200, { media: 'material', targets });
  }

  // videostream needs no browser either: the plugin's Moodle-app handler names the .mp4 in one WS
  // call (docs/MOODLE.md § Videostream).
  if (recording.strategy === 'videostream') {
    if (!recording.pageUrl) return send(res, 400, invalid('ref', 'ref is not downloadable'));
    const found = siteOr(res, recording.pageUrl);
    if (!found) return;
    const { site, auth } = found;
    const token = await tokenOr(res, auth, '/resolve');
    if (!token) return;
    let targets;
    try {
      targets = await resolveVideostream({
        recording,
        course,
        name,
        kind,
        site,
        token,
        ref: rowRef,
        forceCapture: opts.forceCapture,
      });
    } catch (e) {
      if (invalidToken(e)) {
        auth.markExpired();
        logResult('/resolve', 'reconnect (401)');
        return sendReconnect(res);
      }
      if (blocked(e)) {
        logResult('/resolve', `blocked (503): ${e.message}`);
        return sendBlocked(res, e);
      }
      throw e;
    }
    logResult('/resolve', `ok (${targets.length} target, video)`);
    return send(res, 200, { media: 'video', targets });
  }

  // A Drive file needs no browser either, but only the filename probe knows whether it lands
  // as a video or as a material — it reports back which.
  if (recording.strategy === 'google-drive') {
    const { targets, media } = await resolveDriveFile({
      recording,
      course,
      name,
      kind,
      ref: rowRef,
      forceCapture: opts.forceCapture,
    });
    logResult('/resolve', `ok (${targets.length} target, ${media})`);
    return send(res, 200, { media, targets });
  }

  // Any other off-site link is browserless too, and equally opaque until probed — same shape as
  // the Drive branch, a different probe behind it.
  if (recording.strategy === 'direct-url') {
    const { targets, media } = await resolveDirectUrl({
      recording,
      course,
      name,
      kind,
      ref: rowRef,
      forceCapture: opts.forceCapture,
    });
    logResult('/resolve', `ok (${targets.length} target, ${media})`);
    return send(res, 200, { media, targets });
  }

  // An expanded youtube entry carries its direct url, so it needs no browser either.
  if (recording.strategy === 'youtube-playlist' && recording.url) {
    const targets = await resolveYtDlp({
      recording,
      course,
      name,
      kind,
      ref: rowRef,
      forceCapture: opts.forceCapture,
    });
    logResult('/resolve', `ok (${targets.length} target, video)`);
    return send(res, 200, { media: 'video', targets });
  }
  // Strict: only zoom remains, so any other row (an unexpanded playlist, a strategy this build does
  // not know) is refused here.
  if (recording.strategy !== 'zoom') {
    const strategy = typeof recording.strategy === 'string' ? recording.strategy : null;
    throw new UnsupportedError(
      'recording_strategy_unsupported',
      { strategy },
      `no resolver for recording strategy ${strategy ?? '(none)'}`,
    );
  }
  if (!recording.pageUrl) return send(res, 400, invalid('ref', 'ref is not downloadable'));

  // Zoom shares are gated by a passcode, not the Moodle login — no university and no login; the
  // extractor picks its own browser profile (DI), captureVideo clears the gate on a blank session.
  // See docs/ZOOM.md.
  const session = getSession(resolveExtractorForRecording(recording).browserProfile);
  // Per-course default with an optional per-lecture override; null → the gate throws
  // PasscodeError('missing') so the page can prompt. See docs/ZOOM.md.
  const passcode = passcodes.lookup(course, name);
  // A zoom share can hold a before/after-break pair → one target per captured .mp4. open() runs
  // under the lock, so a browser the user closed while an earlier call held it is relaunched.
  const targets = await session.withLock(async () => {
    let page = null;
    try {
      // Inside the try: a window closed during the launch itself maps the same way.
      await session.open();
      page = session.page;
      return await resolveRecording(page, {
        recording,
        course,
        name,
        kind,
        passcode,
        ref: rowRef,
        ...opts,
      });
    } catch (e) {
      if (browserClosed(e, page)) throw zoomBrowserClosed(e);
      throw e;
    }
  });
  logResult('/resolve', `ok (${targets.length} targets, video)`);
  send(res, 200, { media: 'video', targets });
}

// HEAD of a resolved Moodle file, answered from the size its resolve learned — no Moodle call, so
// server/'s size probe never spends a turn of the lock. 401 for an id this process never minted.
export function handleMoodleFileHead(req, res) {
  const file = fileById(req.params.id);
  if (!file) return res.status(401).end();
  res.set('Accept-Ranges', 'bytes');
  if (file.size != null) res.set('Content-Length', String(file.size));
  res.status(200).end();
}

// Headers relayed from Moodle's answer; everything else (cookies, caching) stays behind.
const FILE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'content-disposition',
];

// Open the upstream answer for a proxied file: a pluginfile with the WS token added now, anything
// else with the headers its capture recorded. null after answering (no token, a refused site).
async function openProxied(file, res, { range, signal }) {
  if (!file.pluginfile) return openMoodleFile(file.url, { headers: file.headers, range, signal });
  const found = siteOr(res, file.fileurl);
  if (!found) return null;
  const stored = await tokenOr(res, found.auth, '/moodle/file');
  if (!stored) return null;
  return openPluginfile(pluginfileUrl(file.fileurl, stored.wstoken), { range, signal });
}

// Stream a resolved Moodle-host file to server/ under the lock, Range passed through for a resume.
// An unknown id (auto restarted) is 401, which server/ answers with its one silent re-resolve.
export const handleMoodleFile = gated('/moodle/file', async (req, res) => {
  const file = fileById(req.params.id);
  if (!file) {
    logResult('/moodle/file', 'unknown id (401)');
    return send(res, 401, {
      error: 'unknown file id — resolve the row again',
      code: 'moodle_file_unknown',
      params: {},
    });
  }
  const gone = new AbortController();
  res.on('close', () => gone.abort());
  let upstream;
  try {
    upstream = await openProxied(file, res, { range: req.headers.range, signal: gone.signal });
    if (!upstream) return;
  } catch (e) {
    if (gone.signal.aborted) return;
    if (invalidToken(e)) {
      siteAuth().auth.markExpired();
      logResult('/moodle/file', 'reconnect (401)');
      return sendReconnect(res);
    }
    if (blocked(e)) {
      logResult('/moodle/file', `blocked (503): ${e.message}`);
      return sendBlocked(res, e);
    }
    throw e;
  }
  res.status(upstream.status);
  // fetch hands over a decoded body, so an encoded answer's Content-Length would be the wrong one.
  const decoded = upstream.headers.has('content-encoding');
  for (const name of FILE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value && !(decoded && name === 'content-length')) res.set(name, value);
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
    logResult('/moodle/file', `streamed (${upstream.status})`);
  } catch (e) {
    // The caller hung up or Moodle dropped mid-body: the half-sent answer cannot become an error
    // body, so the socket is cut and curl sees a short read.
    logResult('/moodle/file', `stream ended early: ${e.message}`);
    res.destroy();
  }
});

// Persist a zoom passcode for a course (default) or a single lecture (override). The
// sibling frontend prompt calls this after a 409 `passcode`, then retries the download.
export function handleZoomPasscode(req, res) {
  const { course, name, passcode, scope } = req.body;
  logReq('POST', '/zoom/passcode', `${course}${scope === 'lecture' ? `/${name}` : ''} (${scope})`);
  if (!isSafeName(course)) return send(res, 400, invalid('course', 'course is required'));
  if (scope !== 'course' && scope !== 'lecture')
    return send(res, 400, invalid('scope', `invalid scope: ${scope}`));
  if (scope === 'lecture' && !isSafeName(name))
    return send(res, 400, invalid('name', 'name is required for lecture scope'));
  if (typeof passcode !== 'string' || passcode.length === 0)
    return send(res, 400, invalid('passcode', 'passcode is required'));
  passcodes.save({ course, name, passcode, scope });
  logResult('/zoom/passcode', 'ok');
  send(res, 200, {});
}

export async function handleClose(req, res) {
  logReq('POST', '/close');
  await closeAllSessions();
  send(res, 200, {});
}
