import {
  resolveUniversity,
  defaultUniversity,
  resolveExtractorForRecording,
} from '../core/registry.js';
import { getSession, closeAllSessions } from '../browser/browserSession.js';
import { resolveBrowserChannel } from '../browser/browserChannel.js';
import {
  listRecordings,
  resolveRecording,
  resolveMoodleFile,
  resolveYtDlp,
  resolveDriveFile,
  resolveDirectUrl,
} from '../core/core.js';
import { driveFileId } from '../extractors/GoogleDriveExtractor.js';
import { getProbedMedia } from '../core/probeCache.js';
import { probeKeyForUrl } from '../lib/probeUrl.js';
import { encodeRef, decodeRef } from '../lib/ref.js';
import { CodedError, UnsupportedError, PasscodeError, failureOf } from '../lib/errors.js';
import * as passcodes from '../lib/passcodes.js';
import {
  courseIdFrom,
  getCourseContents,
  getSiteInfo,
  getAutologinKey,
  invalidToken,
  blocked,
} from '../moodle/wsClient.js';

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
    expandable: recording.strategy === 'youtube-playlist' && !recording.url,
    section: recording.section ?? '',
  };
}

// One auth instance PER university, reused across requests so connect()/complete()
// share the same in-memory headed browser. Never evict. Keyed by university id.
const authInstances = new Map();
function authFor(uni) {
  if (!authInstances.has(uni.id)) authInstances.set(uni.id, uni.auth());
  return authInstances.get(uni.id);
}

// Autologin is rate-limited (~1/user/6 min), so its cookie is reused for this long — well under
// the Moodle session lifetime, so it stays valid within the window.
const AUTOLOGIN_TTL_MS = 20 * 60 * 1000;

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
  send(res, 422, { status: 'unsupported', message: err.message, code: err.code, params: err.params });
}

// Distinct "the site served a bot-protection challenge" signal, so the page can say to wait.
// 503: the site is refusing us for now; nothing about the request is wrong.
function sendBlocked(res, err) {
  send(res, 503, { status: 'blocked', message: err.message, code: err.code, params: err.params });
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

// ── Auth endpoints ──────────────────────────────────────────────────────────

export function handleAuthStatus(req, res) {
  send(res, 200, authFor(defaultUniversity()).status());
}

export async function handleAuthConnect(req, res) {
  logReq('POST', '/auth/connect');
  // The token module builds its own launch.php URL, so connect takes no entry URL.
  await authFor(defaultUniversity()).connect();
  send(res, 200, { status: 'pending' });
}

export async function handleAuthComplete(req, res) {
  logReq('POST', '/auth/complete');
  await authFor(defaultUniversity()).complete();
  send(res, 200, { connected: true });
}

export async function handleAuthDisconnect(req, res) {
  logReq('POST', '/auth/disconnect');
  await authFor(defaultUniversity()).disconnect();
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

// ── Browsing endpoints ──────────────────────────────────────────────────────

export async function handleList(req, res) {
  const { courseUrl } = req.body;
  logReq('POST', '/list', courseUrl);
  if (typeof courseUrl !== 'string' || !/^https?:\/\//.test(courseUrl)) {
    return send(res, 400, invalid('courseUrl', 'valid courseUrl required'));
  }
  let uni;
  try {
    uni = resolveUniversity(courseUrl);
  } catch (e) {
    return send(res, 400, failureOf(e));
  }

  const auth = authFor(uni);
  if (!auth.status().connected) {
    logResult('/list', 'reconnect (401)');
    return sendReconnect(res);
  }

  let courseId;
  try {
    courseId = courseIdFrom(courseUrl);
  } catch (e) {
    return send(res, 400, failureOf(e));
  }

  // Stateless WS: no browser needed. A dead token comes back as an invalidToken
  // WS exception → mark expired + steer to Reconnect; any other WS fault falls to 500.
  const token = auth.loadToken().wstoken;
  let sections;
  try {
    sections = await getCourseContents(token, courseId);
  } catch (e) {
    if (invalidToken(e)) {
      auth.markExpired();
      logResult('/list', 'reconnect (401)');
      return sendReconnect(res);
    }
    if (blocked(e)) {
      logResult('/list', `blocked (503): ${e.message}`);
      return sendBlocked(res, e);
    }
    throw e;
  }
  const recordings = listRecordings(sections);
  logResult('/list', `${recordings.length} items`);
  send(res, 200, { items: recordings.map(toItem) });
}

// Resolve ONE expandable item (a YouTube playlist) into its downloadable children by
// running yt-dlp on the direct external URL in the ref — no browser, no auth, no gate.
export async function handleListExpand(req, res) {
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
}

// Symmetric with /list/expand: an unsupported ref on the resolve path surfaces as
// 422, not a 500. Other errors rethrow to the centralized handler.
export async function handleResolve(req, res) {
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
    throw e;
  }
}

async function resolveItem(req, res) {
  const { ref, course, name, kind = 'lecture', only, forceCapture } = req.body;
  logReq('POST', '/resolve', `${course}/${name} (${kind})`);
  // The discovery row's ref groups every server/ job spawned from this resolve (incl. a zoom
  // split pair); it is also the key each cap is memoized under in the replay cache.
  const rowRef = typeof ref === 'string' ? ref : null;
  const recording = decodeRef(ref);
  if (!recording || typeof recording !== 'object')
    return send(res, 400, invalid('ref', 'valid ref required'));
  if (!isSafeName(course) || !isSafeName(name))
    return send(
      res,
      400,
      invalid(isSafeName(course) ? 'name' : 'course', 'course and name are required'),
    );
  if (kind !== 'lecture' && kind !== 'recitation')
    return send(res, 400, invalid('kind', `invalid kind: ${kind}`));

  // only = act on just this one (course,name,kind) target (a no-op for the single-target
  // browserless strategies); forceCapture = bypass the replay and probe caches
  const opts = { only: only === true, forceCapture: forceCapture === true };

  // moodle-file needs no browser either: the ref carries the Moodle fileurl, and the WS
  // token (query-string auth for pluginfile) makes it a plain fetch for server/.
  if (recording.strategy === 'moodle-file') {
    const auth = authFor(resolveUniversity(recording.fileurl));
    if (!auth.status().connected) {
      logResult('/resolve', 'reconnect (401)');
      return sendReconnect(res);
    }
    let targets;
    try {
      targets = await resolveMoodleFile({
        recording,
        course,
        name,
        kind,
        wstoken: auth.loadToken().wstoken,
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

  // An expanded youtube entry carries its direct url, so it needs no browser either;
  // videostream must sniff the .mp4 fresh.
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
  if (!recording.pageUrl) return send(res, 400, invalid('ref', 'ref is not downloadable'));

  // The extractor picks its own browser profile (DI): videostream runs on the plain
  // headless session; zoom runs on the headed chrome+stealth session.
  const profile = resolveExtractorForRecording(recording)?.browserProfile ?? 'plain';
  const session = getSession(profile);

  // Zoom shares are gated by a passcode, not BIU SSO — no university and no login; captureVideo
  // clears the gate on a blank session. See docs/ZOOM.md.
  if (recording.strategy === 'zoom') {
    // Per-course default with an optional per-lecture override; null → the gate throws
    // PasscodeError('missing') so the page can prompt. See docs/ZOOM.md.
    const passcode = passcodes.lookup(course, name);
    await session.open();
    // A zoom share can hold a before/after-break pair → one target per captured .mp4.
    const targets = await session.withLock(() =>
      resolveRecording(session.page, {
        recording,
        course,
        name,
        kind,
        passcode,
        ref: rowRef,
        ...opts,
      }),
    );
    logResult('/resolve', `ok (${targets.length} targets, video)`);
    return send(res, 200, { media: 'video', targets });
  }

  // videostream: sniff the in-site .mp4 in a headless browser logged in via Moodle
  // autologin (privatetoken → one-shot cookie, no MFA). See docs/MOODLE.md.
  const uni = resolveUniversity(recording.pageUrl);
  const auth = authFor(uni);
  if (!auth.status().connected) {
    logResult('/resolve', 'reconnect (401)');
    return sendReconnect(res);
  }
  const token = auth.loadToken();

  await session.open();
  let targets;
  try {
    targets = await session.withLock(async () => {
      await ensureAutologin(session, token);
      return resolveRecording(session.page, {
        recording,
        course,
        name,
        kind,
        ref: rowRef,
        ...opts,
      });
    });
  } catch (e) {
    // getSiteInfo/getAutologinKey surface a dead token (→ 401) or a challenge (→ 503); other
    // faults (rate-limit lockout, no .mp4) fall to 500.
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
  send(res, 200, { media: 'video', targets });
}

// Log the shared plain session into Moodle via a one-shot autologin key, unless a prior cookie is
// still fresh. MUST run inside the session lock (navigates the shared page).
async function ensureAutologin(session, token) {
  if (session.isAuthed()) return;
  if (!token?.privatetoken) {
    throw new CodedError(
      'moodle_token_no_privatetoken',
      {},
      'token has no privatetoken; Reconnect to enable videostream capture',
    );
  }
  const { userid } = await getSiteInfo(token.wstoken);
  const { key, autologinurl } = await getAutologinKey(token.wstoken, token.privatetoken);
  // autologinurl is a bare endpoint; add userid+key via the URL API (it may already carry a query).
  const u = new URL(autologinurl);
  u.searchParams.set('userid', userid);
  u.searchParams.set('key', key);
  await session.goto(u.toString());
  session.markAuthed(AUTOLOGIN_TTL_MS);
}

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
