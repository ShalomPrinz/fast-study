import http from 'node:http';
import { AUTODL_PORT, SERVER_URL, AUTH_ENTRY_URL } from './config.js';
import { resolveUniversity, defaultUniversity, resolveExtractorForRecording } from './registry.js';
import { isLoginUrl } from './auth/MicrosoftAuth.js';
import { session } from './browserSession.js';
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
  await authFor(defaultUniversity()).connect(entryUrl || AUTH_ENTRY_URL);
  send(res, 200, { status: 'pending' });
}

async function handleAuthComplete(res) {
  logReq('POST', '/auth/complete');
  const auth = authFor(defaultUniversity());
  const state = await auth.complete();
  // If the persistent browser is already open, its context holds the now-stale
  // cookies — rebuild it from the fresh state so the next /list is authenticated.
  if (session.isOpen()) await session.rebuildContext(state);
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

  const auth = authFor(uni);
  const state = auth.loadState();
  if (!state || auth.status().expired) { logResult('/list', 'reconnect (401)'); return sendReconnect(res); }

  await session.open(state);
  // withLock returns null as a sentinel for "the session bounced to login" so the
  // reconnect signal is sent OUTSIDE the lock (can't send from inside cleanly).
  const recordings = await session.withLock(async () => {
    const finalUrl = await session.goto(courseUrl);
    if (isLoginUrl(finalUrl)) return null;
    const items = await listRecordings(session.page, courseUrl);
    return items.map((it) => it.recording);
  });
  // Runtime bounce: the nav actually landed on login/enrol, so the server (not the
  // cheap cookie heuristic) is now the source of truth — mark the cached instance
  // expired so the next /auth/status reports expired:true.
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
  const auth = authFor(resolveUniversity(recording.pageUrl));
  const state = auth.loadState();
  if (!state || auth.status().expired) { logResult('/list/expand', 'reconnect (401)'); return sendReconnect(res); }

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

  const auth = authFor(resolveUniversity(recording.pageUrl));
  const state = auth.loadState();
  if (!state || auth.status().expired) { logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }

  await session.open(state);
  // Lock covers the whole navigate+sniff (captureVideo navigates internally); the
  // POST to server.js is quick — server.js returns immediately and downloads in bg.
  // Mirror /list: pre-nav to pageUrl detects a runtime login/enrol bounce (null
  // sentinel) so an expired session steers to Reconnect instead of throwing a 500.
  const bounced = await session.withLock(async () => {
    if (isLoginUrl(await session.goto(recording.pageUrl))) return true;
    await downloadRecording(session.page, { recording, course, name, kind });
    return false;
  });
  if (bounced) { auth.markExpired(); logResult('/download-item', 'reconnect (401)'); return sendReconnect(res); }
  logResult('/download-item', 'ok');
  send(res, 200, { ok: true });
}

async function handleClose(res) {
  logReq('POST', '/close');
  await session.close();
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

// Close the persistent browser on shutdown so no headless Chromium is orphaned.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    session.close().finally(() => process.exit(0));
  });
}

server.listen(AUTODL_PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🤖 Auto-downloader listening on port ${AUTODL_PORT}`);
  console.log(`📥 SERVER_URL: ${SERVER_URL}`);
  console.log(`🌐 CORS origin: ${ALLOWED_ORIGIN}`);
  console.log(`==========================================\n`);
});
