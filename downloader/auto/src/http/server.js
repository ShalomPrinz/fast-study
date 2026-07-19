import { resolveUniversity, defaultUniversity, resolveExtractorForRecording } from '../core/registry.js';
import { getSession, closeAllSessions } from '../browser/browserSession.js';
import { listRecordings, downloadRecording } from '../core/core.js';
import { encodeRef, decodeRef } from '../lib/ref.js';
import { UnsupportedError, PasscodeError } from '../lib/errors.js';
import * as passcodes from '../lib/passcodes.js';
import {
  courseIdFrom,
  getCourseContents,
  getSiteInfo,
  getAutologinKey,
  invalidToken,
} from '../moodle/wsClient.js';

// Mechanism-agnostic item; the mechanism hides inside the opaque `ref`. An
// unexpanded playlist (pageUrl, no url) is expandable, else downloadable. See docs/BROWSING.md.
function toItem(recording) {
  return {
    ref: encodeRef(recording),
    title: recording.title,
    kind: recording.kind,
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

// Reuse the autologin cookie across back-to-back videostream downloads: autologin is
// rate-limited (~1/user/6 min), so re-minting a key every download would 429. Well under
// the Moodle session lifetime, so a cached cookie stays valid within the window.
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

// Distinct "session expired → steer the user to Reconnect" signal.
function sendReconnect(res) {
  send(res, 401, { status: 'reconnect' });
}

// Distinct "this item can't be expanded/downloaded" signal (e.g. a `url` module
// redirecting off-YouTube) so the page shows the specific reason.
export function sendUnsupported(res, message) {
  send(res, 422, { status: 'unsupported', message });
}

// Distinct "the zoom passcode gate couldn't be cleared" signal so the page can prompt
// for a passcode (reason 'missing') or flag a wrong one (reason 'incorrect') and retry.
function sendPasscode(res, { reason, course, name }) {
  send(res, 409, { status: 'passcode', reason, course, name });
}

// Same guard as server/server.js: reject path-traversal / empty names before
// they reach the database service.
function isSafeName(name) {
  return typeof name === 'string'
    && name.length > 0
    && !name.includes('/')
    && !name.includes('\\')
    && name !== '.'
    && name !== '..';
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

// ── Browsing endpoints ──────────────────────────────────────────────────────

export async function handleList(req, res) {
  const { courseUrl } = req.body;
  logReq('POST', '/list', courseUrl);
  if (typeof courseUrl !== 'string' || !/^https?:\/\//.test(courseUrl)) {
    return send(res, 400, { error: 'valid courseUrl required' });
  }
  let uni;
  try { uni = resolveUniversity(courseUrl); } catch (e) { return send(res, 400, { error: e.message }); }

  const auth = authFor(uni);
  if (!auth.status().connected) { logResult('/list', 'reconnect (401)'); return sendReconnect(res); }

  let courseId;
  try { courseId = courseIdFrom(courseUrl); } catch (e) { return send(res, 400, { error: e.message }); }

  // Stateless WS: no browser needed. A dead token comes back as an invalidToken
  // WS exception → mark expired + steer to Reconnect; any other WS fault falls to 500.
  const token = auth.loadToken().wstoken;
  let sections;
  try {
    sections = await getCourseContents(token, courseId);
  } catch (e) {
    if (invalidToken(e)) { auth.markExpired(); logResult('/list', 'reconnect (401)'); return sendReconnect(res); }
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
    return send(res, 400, { error: 'item is not expandable' });
  }
  let entries;
  try {
    entries = await extractor.listEntries(recording);
  } catch (e) {
    if (e instanceof UnsupportedError) { logResult('/list/expand', `unsupported (422): ${e.message}`); return sendUnsupported(res, e.message); }
    throw e; // other failures fall through to the centralized 500 ("try again")
  }
  // Each entry becomes a concrete, downloadable child (has a direct url → not
  // expandable). The child's ref carries the youtube recording for /download-item.
  const items = entries.map((e) =>
    toItem({ title: e.title, url: e.url, kind: recording.kind, strategy: recording.strategy, section: recording.section }),
  );
  logResult('/list/expand', `${items.length} items`);
  send(res, 200, { items });
}

// Symmetric with /list/expand: an unsupported ref on the download path surfaces as
// 422, not a 500. Other errors rethrow to the centralized handler.
export async function handleDownloadItem(req, res) {
  try {
    await downloadItem(req, res);
  } catch (e) {
    if (e instanceof UnsupportedError) { logResult('/download-item', `unsupported (422): ${e.message}`); return sendUnsupported(res, e.message); }
    if (e instanceof PasscodeError) {
      const { course, name } = req.body;
      logResult('/download-item', `passcode ${e.reason} (409)`);
      return sendPasscode(res, { reason: e.reason, course, name });
    }
    throw e;
  }
}

async function downloadItem(req, res) {
  const { ref, course, name, kind = 'lecture' } = req.body;
  logReq('POST', '/download-item', `${course}/${name} (${kind})`);
  const recording = decodeRef(ref);
  if (!recording || typeof recording !== 'object') return send(res, 400, { error: 'valid ref required' });
  if (!isSafeName(course) || !isSafeName(name)) return send(res, 400, { error: 'course and name are required' });
  if (kind !== 'lecture' && kind !== 'recitation') return send(res, 400, { error: `invalid kind: ${kind}` });

  // yt-dlp strategies need no browser: a youtube entry carries its direct url (playlist
  // already expanded), a Drive file its pageUrl. videostream must sniff the .mp4 fresh.
  if ((recording.strategy === 'youtube-playlist' && recording.url) || recording.strategy === 'google-drive') {
    await downloadRecording(null, { recording, course, name, kind });
    logResult('/download-item', 'ok');
    return send(res, 200, { ok: true });
  }
  if (!recording.pageUrl) return send(res, 400, { error: 'ref is not downloadable' });

  // The extractor picks its own browser profile (DI): videostream runs on the plain
  // headless session; zoom runs on the chrome+stealth+Xvfb session.
  const profile = resolveExtractorForRecording(recording)?.browserProfile ?? 'plain';
  const session = getSession(profile);

  // Zoom shares live on `*.zoom.us`, gated by a passcode not BIU SSO — no university to
  // resolve and no login. Open a blank session and let captureVideo clear the passcode
  // gate. See docs/ZOOM.md.
  if (recording.strategy === 'zoom') {
    // Per-course default with an optional per-lecture override; null → the gate throws
    // PasscodeError('missing') so the page can prompt. See docs/ZOOM.md.
    const passcode = passcodes.lookup(course, name);
    await session.open();
    await session.withLock(() => downloadRecording(session.page, { recording, course, name, kind, passcode }));
    logResult('/download-item', 'ok');
    return send(res, 200, { ok: true });
  }

  // videostream: sniff the in-site .mp4 in a headless browser logged in via Moodle
  // autologin (privatetoken → one-shot cookie, no MFA). See docs/MOODLE.md.
  const uni = resolveUniversity(recording.pageUrl);
  const auth = authFor(uni);
  if (!auth.status().connected) { logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }
  const token = auth.loadToken();

  await session.open();
  try {
    await session.withLock(async () => {
      await ensureAutologin(session, token);
      await downloadRecording(session.page, { recording, course, name, kind });
    });
  } catch (e) {
    // A dead token surfaces from getSiteInfo/getAutologinKey as an invalidToken WS
    // exception → Reconnect. Other faults (rate-limit lockout, no .mp4) fall to 500.
    if (invalidToken(e)) { auth.markExpired(); logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }
    throw e;
  }
  logResult('/download-item', 'ok');
  send(res, 200, { ok: true });
}

// Log the shared plain session into Moodle via a one-shot autologin key so the token-gated
// .mp4 sniffs authenticated. Skips the rate-limited key mint while a prior cookie is fresh.
// MUST run inside the session lock (navigates the shared page).
async function ensureAutologin(session, token) {
  if (session.isAuthed()) return;
  if (!token?.privatetoken) {
    throw new Error('token has no privatetoken; Reconnect to enable videostream capture');
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
// sibling frontend prompt calls this after a 409 `passcode`, then retries /download-item.
export function handleZoomPasscode(req, res) {
  const { course, name, passcode, scope } = req.body;
  logReq('POST', '/zoom/passcode', `${course}${scope === 'lecture' ? `/${name}` : ''} (${scope})`);
  if (!isSafeName(course)) return send(res, 400, { error: 'course is required' });
  if (scope !== 'course' && scope !== 'lecture') return send(res, 400, { error: `invalid scope: ${scope}` });
  if (scope === 'lecture' && !isSafeName(name)) return send(res, 400, { error: 'name is required for lecture scope' });
  if (typeof passcode !== 'string' || passcode.length === 0) return send(res, 400, { error: 'passcode is required' });
  passcodes.save({ course, name, passcode, scope });
  logResult('/zoom/passcode', 'ok');
  send(res, 200, { ok: true });
}

export async function handleClose(req, res) {
  logReq('POST', '/close');
  await closeAllSessions();
  send(res, 200, { ok: true });
}
