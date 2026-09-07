import { timingSafeEqual } from 'node:crypto';
import { getSystemErrorMessage } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Constant-time secret comparison, matching the Python services' compare_digest: the threat model
// is a hostile local process, which is exactly the attacker able to time loopback replies.
// Length is checked first because timingSafeEqual throws on unequal buffers, and the secret's
// length is fixed by the launcher and not itself a secret.
function secretMatches(given, secret) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Binds the express app to loopback only and reports the port it actually got.
// FASTSTUDY_PORT=0 asks the OS for an ephemeral port, so the bound port is read back off
// server.address() and printed alone on its own line for the launcher to parse.
export function serve(app, defaultPort, onListening) {
  const host = '127.0.0.1';
  const port = Number(process.env.FASTSTUDY_PORT ?? defaultPort);
  // Deliberately no listen callback: express registers one on 'error' too, so a failed bind would
  // call it with a null address and die of a TypeError instead of naming the real EADDRINUSE.
  const server = app.listen(port, host);
  server.once('listening', () => {
    const boundPort = server.address().port;
    console.log(`FASTSTUDY_PORT=${boundPort}`);
    onListening(boundPort);
  });
  // stderr, never stdout: stdout is the port-handshake channel the launcher parses.
  server.once('error', (err) => {
    const code = err.code ?? String(err.errno ?? 'EUNKNOWN');
    console.error(`faststudy: cannot bind ${host}:${port} — ${code} (${describe(err)})`);
    process.exit(1);
  });
  return server;
}

// The libuv description behind an errno ('address already in use'), matching what the Python half
// gets from os.strerror. Falls back to the error's own message if the errno is not a system one.
function describe(err) {
  return typeof err.errno === 'number' ? getSystemErrorMessage(err.errno) : err.message;
}

// Rejects any request that does not carry the launch secret, as an X-FastStudy-Secret header or
// a `secret` query parameter — EventSource is the one caller that cannot set a header.
// Unset FASTSTUDY_SECRET (dev) means no enforcement at all.
export function requireSecret(req, res, next) {
  const secret = process.env.FASTSTUDY_SECRET;
  // GET /health is exempt by method and path, not merely by registration order: the launcher's boot
  // screen needs it to answer without the secret to tell a wrong secret from a dead child.
  if (!secret || (req.method === 'GET' && req.path === '/health')) return next();
  // Tried independently rather than `header ?? query`: a wrong or blank header must not shadow the
  // query parameter, which is the only credential EventSource can send.
  if (secretMatches(req.get('X-FastStudy-Secret'), secret)) return next();
  if (secretMatches(req.query.secret, secret)) return next();
  // Chromium reports any other MIME on an EventSource as a bare onerror, so a JSON 401 would read
  // as a transport failure rather than an auth one.
  if ((req.get('Accept') ?? '').includes('text/event-stream')) {
    return res.status(401).type('text/event-stream').end();
  }
  res.status(401).json({ error: 'unauthorized' });
}

// Headers for an outbound call to one of our own services, carrying the launch secret when there
// is one. Peers only — sending it to an external lecture host would leak it (services/probe.js).
export function peerHeaders(headers = {}) {
  const secret = process.env.FASTSTUDY_SECRET;
  return secret ? { ...headers, 'X-FastStudy-Secret': secret } : { ...headers };
}

// Joins a path under the per-user writable state root: FASTSTUDY_STATE_DIR when the launcher sets
// one, else `.state/` at the repo root. A pure join — callers create the directories they write to.
export function statePath(...parts) {
  // This file is `<repo>/lib/runtime/js/runtime.js`, so the repo root is three directories up.
  const root =
    process.env.FASTSTUDY_STATE_DIR ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', '.state');
  return path.join(root, ...parts);
}
