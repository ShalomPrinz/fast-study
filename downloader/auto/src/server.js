import http from 'node:http';
import { AUTODL_PORT, SERVER_URL, AUTH_ENTRY_URL } from './config.js';
import { resolveUniversity, defaultUniversity, resolveExtractorForRecording } from './registry.js';
import { getSession, rebuildOpenSessions, closeAllSessions } from './browserSession.js';
import { listRecordings, downloadRecording } from './core.js';
import { encodeRef, decodeRef } from './ref.js';

// Uniform, mechanism-agnostic item the frontend sees. The download mechanism
// (videostream / youtube / playlist) is hidden inside the opaque `ref`; the
// frontend only reads `expandable` to decide /list/expand vs /download-item.
// A recording that's an unexpanded playlist (has pageUrl, no direct url) is
// expandable; concrete videostream/youtube-entry recordings are downloadable.
function toItem(recording) {
  return {
    ref: encodeRef(recording),
    title: recording.title,
    kind: recording.kind,
    expandable: recording.strategy === 'youtube-playlist' && !recording.url,
  };
}

// Browser-facing (the Vite dev origin), unlike downloader/server/server.js which
// is locked to the extension ID. Only the frontend drives this service.
const ALLOWED_ORIGIN = 'http://localhost:5173';

// One auth instance PER university, reused across requests: connect()/complete()
// share the same in-memory headed browser, so a fresh instance per call would
// lose the pending login. Keyed by university id (single-university for now).
const authInstances = new Map();
function authFor(uni) {
  if (!authInstances.has(uni.id)) authInstances.set(uni.id, uni.auth());
  return authInstances.get(uni.id);
}

// ── Auth gate ─────────────────────────────────────────────────────────────────
// Per-university barrier the browsing endpoints await BEFORE they touch cookies or
// the browser. Closed on /auth/connect, opened on /auth/complete AFTER the context
// rebuild. In-memory run state only — never persisted (mirrors authInstances above).
//
// WHY: /auth/complete persists fresh cookies then rebuildOpenSessions() swaps the
// shared session's context to them. open() is a no-op when already open and doesn't
// route through withLock, so a /list fired during "finishing…" used to navigate on
// the STALE pre-login context → bounce to the Microsoft login → silent SSO recovery
// fails → markExpired() flips a PERMANENT false "expired". The gate makes such a
// /list park (async, zero-CPU) until the rebuild finishes, then run on fresh cookies.
// Before: /list during finishing… → stale context → bounce → stuck _invalidated
// After:  /list during finishing… → parks on gate → runs on fresh cookies → items
//
// Release-on-cancel (WHY it isn't just the timer): a gate that opens ONLY on
// /auth/complete blocks forever if the user closes the login window / MFA fails —
// complete() never fires. The PRIMARY release is the headed login browser's
// `disconnected` event, routed through connect()'s onCancel → openAuthGate, so a
// parked /list wakes IMMEDIATELY (re-checks auth.status() → still expired → reconnect)
// and the user can retry at once. The AUTH_GATE_BACKSTOP_MS timer is only a last-resort
// safety valve for the pathological case where the browser neither completes nor emits
// `disconnected` (e.g. a hung process). It can't just be shortened instead: a legitimately
// slow MFA login must not have its gate cut early — that would reconnect-error a parked
// request mid-login. The event is what keeps the timer rare rather than routine.
//
// Step-7 decision (rebuildContext/open under withLock): NOT done. The gate already
// establishes happens-before for the login case (browsing can't run until the rebuild
// completed). Wrapping rebuildContext/open in withLock risks deadlock — rebuildOpenSessions
// runs from /auth/complete OUTSIDE any lock, while browsing calls open() INSIDE withLock,
// so a shared lock could interleave into a hold-and-wait — for no gain the gate doesn't
// already give. Left as-is; the gate is what guarantees ordering.
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
// Guarded to be idempotent-safe: re-closing an already-closed gate keeps the SAME
// pending promise (so awaiters already parked on it aren't orphaned) and only re-arms
// the timer — replacing the promise would strand them with no backstop of their own.
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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Lightweight request logging — one line in, one line out per request. Enough to
// see each request and diagnose an empty list (the parsed item count), without
// dumping DOM / storageState / secrets.
function logReq(method, path, detail) {
  console.log(`→ ${method} ${path}${detail ? `  ${detail}` : ''}`);
}
function logResult(path, msg) {
  console.log(`↳ ${path} → ${msg}`);
}

// Distinct "session expired → steer the user to Reconnect" signal, so the page
// can open the auth pill rather than toast a generic 500. 401 = unauthenticated.
function sendReconnect(res) {
  send(res, 401, { status: 'reconnect' });
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

function handleAuthStatus(res) {
  send(res, 200, authFor(defaultUniversity()).status());
}

async function handleAuthConnect(req, res) {
  logReq('POST', '/auth/connect');
  const { entryUrl } = JSON.parse((await readBody(req)) || '{}');
  const uni = defaultUniversity();
  // Close the gate as the login starts so browsing parks until /auth/complete rebuilds
  // on fresh cookies. Closing BEFORE connect (not after) removes any window where the
  // browser's disconnected event could race the close. Released immediately by that
  // disconnected event if the user abandons the login (onCancel → openAuthGate), on a
  // connect() throw, or — last-resort backstop only — the timer inside closeAuthGate.
  closeAuthGate(uni);
  try {
    await authFor(uni).connect(entryUrl || AUTH_ENTRY_URL, { onCancel: () => openAuthGate(uni) });
  } catch (e) {
    openAuthGate(uni);
    throw e;
  }
  send(res, 200, { status: 'pending' });
}

async function handleAuthComplete(res) {
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

async function handleList(req, res) {
  const { courseUrl } = JSON.parse(await readBody(req));
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
  // withLock returns null as a sentinel for "the session bounced to login AND silent
  // SSO recovery failed" so the reconnect signal is sent OUTSIDE the lock (can't send
  // from inside cleanly). gotoAuthenticated absorbs a recoverable bounce silently.
  const recordings = await session.withLock(async () => {
    const nav = await session.gotoAuthenticated(courseUrl, auth);
    if (!nav) return null;
    return listRecordings(session.page, courseUrl);
  });
  // Runtime bounce that couldn't self-recover: the AAD session is genuinely gone, so
  // the server (not the cheap cookie heuristic) is now the source of truth — mark the
  // cached instance expired so the next /auth/status reports expired:true.
  if (recordings === null) { auth.markExpired(); logResult('/list', 'reconnect (401)'); return sendReconnect(res); }
  logResult('/list', `${recordings.length} items`);
  send(res, 200, { items: recordings.map(toItem) });
}

// Resolve ONE expandable item (a playlist) into its downloadable children. The
// route name and body are mechanism-neutral; the redirect-follow + yt-dlp
// --flat-playlist lives behind the extractor and the opaque ref.
async function handleListExpand(req, res) {
  logReq('POST', '/list/expand', '(expanding)');
  const { ref } = JSON.parse(await readBody(req));
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
  const entries = await session.withLock(() => extractor.listEntries(session.page, recording));
  // Each entry becomes a concrete, downloadable child (has a direct url → not
  // expandable). The child's ref carries the youtube recording for /download-item.
  const items = entries.map((e) =>
    toItem({ title: e.title, url: e.url, kind: recording.kind, strategy: recording.strategy }),
  );
  logResult('/list/expand', `${items.length} items`);
  send(res, 200, { items });
}

async function handleDownloadItem(req, res) {
  const { ref, course, name, kind = 'lecture' } = JSON.parse(await readBody(req));
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

  // Zoom shares live on `*.zoom.us` (not the course host) and are gated by a
  // passcode, NOT BIU SSO — so resolving a university from the zoom pageUrl would
  // throw ("No university/auth handler"), and there's no login bounce to recover
  // from. Open the browser (reusing BIU state if present, else a fresh context)
  // and let captureVideo navigate + clear the passcode gate itself.
  if (recording.strategy === 'zoom') {
    await session.open(authFor(defaultUniversity()).loadState() ?? undefined);
    await session.withLock(() => downloadRecording(session.page, { recording, course, name, kind }));
    logResult('/download-item', 'ok');
    return send(res, 200, { ok: true });
  }

  const uni = resolveUniversity(recording.pageUrl);
  await authGate(uni); // park if a login+rebuild is in progress → proceed on fresh cookies
  const auth = authFor(uni);
  const state = auth.loadState();
  if (!state || auth.status().expired) { logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }

  await session.open(state);
  // Lock covers the whole navigate+sniff (captureVideo navigates internally); the
  // POST to server.js is quick — server.js returns immediately and downloads in bg.
  // Mirror /list: gotoAuthenticated first tries a silent SSO recovery on a login/enrol
  // bounce; only an unrecoverable bounce (null) steers to Reconnect instead of a 500.
  const bounced = await session.withLock(async () => {
    if (!(await session.gotoAuthenticated(recording.pageUrl, auth))) return true;
    await downloadRecording(session.page, { recording, course, name, kind });
    return false;
  });
  if (bounced) { auth.markExpired(); logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }
  logResult('/download-item', 'ok');
  send(res, 200, { ok: true });
}

async function handleClose(res) {
  logReq('POST', '/close');
  await closeAllSessions();
  send(res, 200, { ok: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (req.method === 'GET' && req.url === '/auth/status') return handleAuthStatus(res);
    if (req.method === 'POST' && req.url === '/auth/connect') return await handleAuthConnect(req, res);
    if (req.method === 'POST' && req.url === '/auth/complete') return await handleAuthComplete(res);
    if (req.method === 'POST' && req.url === '/list') return await handleList(req, res);
    if (req.method === 'POST' && req.url === '/list/expand') return await handleListExpand(req, res);
    if (req.method === 'POST' && req.url === '/download-item') return await handleDownloadItem(req, res);
    if (req.method === 'POST' && req.url === '/close') return await handleClose(res);
    res.writeHead(404).end();
  } catch (e) {
    console.error(e?.stack ?? String(e));
    send(res, 500, { error: e.message ?? 'Server error' });
  }
});

// Close every session (and the managed Xvfb) on shutdown so no browser or virtual
// display is orphaned.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    closeAllSessions().finally(() => process.exit(0));
  });
}

server.listen(AUTODL_PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🤖 Auto-downloader listening on port ${AUTODL_PORT}`);
  console.log(`📥 SERVER_URL: ${SERVER_URL}`);
  console.log(`🌐 CORS origin: ${ALLOWED_ORIGIN}`);
  console.log(`==========================================\n`);
});
