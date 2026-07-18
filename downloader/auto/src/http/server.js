import { AUTH_ENTRY_URL } from '../lib/config.js';
import { resolveUniversity, defaultUniversity, resolveExtractorForRecording } from '../core/registry.js';
import { getSession, rebuildOpenSessions, closeAllSessions } from '../browser/browserSession.js';
import { listRecordings, downloadRecording } from '../core/core.js';
import { encodeRef, decodeRef } from '../lib/ref.js';
import { UnsupportedError, PasscodeError } from '../lib/errors.js';
import * as passcodes from '../lib/passcodes.js';

// Mechanism-agnostic item; the mechanism hides inside the opaque `ref`. An
// unexpanded playlist (pageUrl, no url) is expandable, else downloadable. See docs/BROWSING.md.
function toItem(recording) {
  return {
    ref: encodeRef(recording),
    title: recording.title,
    kind: recording.kind,
    expandable: recording.strategy === 'youtube-playlist' && !recording.url,
  };
}

// One auth instance PER university, reused across requests so connect()/complete()
// share the same in-memory headed browser. Never evict. Keyed by university id.
const authInstances = new Map();
function authFor(uni) {
  if (!authInstances.has(uni.id)) authInstances.set(uni.id, uni.auth());
  return authInstances.get(uni.id);
}

// ── Auth gate ─────────────────────────────────────────────────────────────────
// Per-university barrier browsing endpoints await before touching cookies/browser:
// closed on /auth/connect, opened on /auth/complete AFTER the context rebuild, so a
// /list fired mid-login parks and runs on fresh cookies (not the stale pre-login
// context, which bounces → a permanent false "expired"). See docs/AUTH.md.
const AUTH_GATE_BACKSTOP_MS = 3 * 60 * 1000; // > a real MFA login; release-on-timeout safety valve only

const authGates = new Map();
function gateFor(uni) {
  if (!authGates.has(uni.id)) authGates.set(uni.id, { promise: Promise.resolve(), resolve: null, timer: null });
  return authGates.get(uni.id);
}

// Browsing endpoints await this: already-resolved when no login is in progress
// (proceed immediately), pending while one is (park until complete/backstop opens it).
function authGate(uni) {
  return gateFor(uni).promise;
}

// Close the gate: park future browsing on a fresh pending promise + arm the backstop.
// Re-closing keeps the SAME pending promise (don't orphan already-parked awaiters).
function closeAuthGate(uni) {
  const gate = gateFor(uni);
  if (!gate.resolve) gate.promise = new Promise((res) => { gate.resolve = res; });
  if (gate.timer) clearTimeout(gate.timer);
  gate.timer = setTimeout(() => openAuthGate(uni), AUTH_GATE_BACKSTOP_MS);
  gate.timer.unref?.(); // don't keep the process alive just for the backstop (match _touch's idle timer)
}

// Open the gate: release every parked browsing request. No-op if already open.
function openAuthGate(uni) {
  const gate = gateFor(uni);
  if (gate.timer) { clearTimeout(gate.timer); gate.timer = null; }
  if (gate.resolve) { gate.resolve(); gate.resolve = null; }
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
  const { entryUrl } = req.body; // express.json() yields {} for an empty body → entryUrl undefined
  const uni = defaultUniversity();
  // Close the gate BEFORE connect (no race with the browser's disconnected event) so
  // browsing parks until /auth/complete rebuilds on fresh cookies. See docs/AUTH.md.
  closeAuthGate(uni);
  try {
    await authFor(uni).connect(entryUrl || AUTH_ENTRY_URL, { onCancel: () => openAuthGate(uni) });
  } catch (e) {
    openAuthGate(uni);
    throw e;
  }
  send(res, 200, { status: 'pending' });
}

export async function handleAuthComplete(req, res) {
  logReq('POST', '/auth/complete');
  const uni = defaultUniversity();
  const auth = authFor(uni);
  try {
    const state = await auth.complete();
    // Any already-open session's context holds the now-stale cookies — rebuild every
    // open one from the fresh state so the next /list (or zoom capture) is authenticated.
    await rebuildOpenSessions(state);
  } finally {
    // Open even if complete()/rebuild threw — a failed rebuild must not hang future
    // browsing forever; the next browsing call just re-opens the context via open().
    openAuthGate(uni);
  }
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

  await authGate(uni); // park if a login+rebuild is in progress → proceed on fresh cookies
  const auth = authFor(uni);
  const state = auth.loadState();
  if (!state || auth.status().expired) { logResult('/list', 'reconnect (401)'); return sendReconnect(res); }

  const session = getSession('plain');
  await session.open(state);
  // null = bounced to login AND silent SSO recovery failed; sent as reconnect OUTSIDE
  // the lock. gotoAuthenticated absorbs a recoverable bounce silently (docs/AUTH.md).
  const recordings = await session.withLock(async () => {
    const nav = await session.gotoAuthenticated(courseUrl, auth);
    if (!nav) return null;
    return listRecordings(session.page, courseUrl);
  });
  // Unrecoverable bounce: AAD session genuinely gone → server is source of truth.
  if (recordings === null) { auth.markExpired(); logResult('/list', 'reconnect (401)'); return sendReconnect(res); }
  logResult('/list', `${recordings.length} items`);
  send(res, 200, { items: recordings.map(toItem) });
}

// Resolve ONE expandable item (a playlist) into its downloadable children; the
// redirect-follow + yt-dlp --flat-playlist lives behind the extractor + opaque ref.
export async function handleListExpand(req, res) {
  logReq('POST', '/list/expand', '(expanding)');
  const { ref } = req.body;
  const recording = decodeRef(ref);
  const extractor = resolveExtractorForRecording(recording);
  if (!recording?.pageUrl || typeof extractor?.listEntries !== 'function') {
    return send(res, 400, { error: 'item is not expandable' });
  }
  const uni = resolveUniversity(recording.pageUrl);
  await authGate(uni); // park if a login+rebuild is in progress → proceed on fresh cookies
  const auth = authFor(uni);
  const state = auth.loadState();
  if (!state || auth.status().expired) { logResult('/list/expand', 'reconnect (401)'); return sendReconnect(res); }

  const session = getSession('plain');
  await session.open(state);
  let entries;
  try {
    entries = await session.withLock(() => extractor.listEntries(session.page, recording));
  } catch (e) {
    if (e instanceof UnsupportedError) { logResult('/list/expand', `unsupported (422): ${e.message}`); return sendUnsupported(res, e.message); }
    throw e; // other failures fall through to the centralized 500 ("try again")
  }
  // Each entry becomes a concrete, downloadable child (has a direct url → not
  // expandable). The child's ref carries the youtube recording for /download-item.
  const items = entries.map((e) =>
    toItem({ title: e.title, url: e.url, kind: recording.kind, strategy: recording.strategy }),
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

  // A youtube entry carries its direct url (playlist already expanded) and needs
  // no browser; videostream must sniff the .mp4 fresh on the shared page.
  if (recording.strategy === 'youtube-playlist' && recording.url) {
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
  // resolve and no login bounce. Open (reuse BIU state if present) and let captureVideo
  // clear the passcode gate. See docs/ZOOM.md.
  if (recording.strategy === 'zoom') {
    // Per-course default with an optional per-lecture override; null → the gate throws
    // PasscodeError('missing') so the page can prompt. See docs/ZOOM.md.
    const passcode = passcodes.lookup(course, name);
    await session.open(authFor(defaultUniversity()).loadState() ?? undefined);
    await session.withLock(() => downloadRecording(session.page, { recording, course, name, kind, passcode }));
    logResult('/download-item', 'ok');
    return send(res, 200, { ok: true });
  }

  const uni = resolveUniversity(recording.pageUrl);
  await authGate(uni); // park if a login+rebuild is in progress → proceed on fresh cookies
  const auth = authFor(uni);
  const state = auth.loadState();
  if (!state || auth.status().expired) { logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }

  await session.open(state);
  // Lock covers the whole navigate+sniff (captureVideo navigates internally). Mirror
  // /list: an unrecoverable login/enrol bounce steers to Reconnect instead of a 500.
  const bounced = await session.withLock(async () => {
    if (!(await session.gotoAuthenticated(recording.pageUrl, auth))) return true;
    await downloadRecording(session.page, { recording, course, name, kind });
    return false;
  });
  if (bounced) { auth.markExpired(); logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }
  logResult('/download-item', 'ok');
  send(res, 200, { ok: true });
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
