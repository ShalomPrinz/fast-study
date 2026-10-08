// GET /auth/events: current auth state on subscribe, again on every change, behind the launch secret
// (query param, since EventSource cannot set a header). Real express, stubbed fetch, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-events-'));
process.env.FASTSTUDY_STATE_DIR = STATE_DIR;
process.env.FASTSTUDY_SECRET = 'launch-secret';
process.on('exit', () => fs.rmSync(STATE_DIR, { recursive: true, force: true }));

import express from 'express';
import { requireSecret } from '@faststudy/runtime';
import { setCurrentSite } from '../src/moodle/site.js';
import { writeTokenFile } from '../src/auth/tokenStore.js';
import { handleAuthEvents, handleAuthComplete } from '../src/http/server.js';
import { moodleGate } from '../src/moodle/gate.js';

const SITE = 'https://moodle.test';
const TOKEN_FILE = path.join(STATE_DIR, 'auth', 'moodle-token.json');
const GOOD = {
  userid: 7,
  downloadfiles: 1,
  functions: [{ name: 'core_course_get_contents' }, { name: 'tool_mobile_get_autologin_key' }],
};

async function serve(t) {
  const app = express();
  app.use(requireSecret);
  app.get('/auth/events', handleAuthEvents);
  app.post('/auth/complete', handleAuthComplete);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

// Reads `data:` events off a stream one at a time.
function reader(res) {
  const body = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  return async function next() {
    while (!buf.includes('\n\n')) {
      const { value, done } = await body.read();
      if (done) throw new Error('stream ended');
      buf += decoder.decode(value, { stream: true });
    }
    const i = buf.indexOf('\n\n');
    const frame = buf.slice(0, i);
    buf = buf.slice(i + 2);
    return JSON.parse(frame.replace(/^data: /, ''));
  };
}

test('the stream sends the state on subscribe and on every change, and needs the secret', async (t) => {
  setCurrentSite(SITE);
  t.after(() => setCurrentSite(null));
  moodleGate.cooldownMs = 20; // a real cooldown, short: the false frame must follow its timer
  const base = await serve(t);

  assert.equal((await fetch(`${base}/auth/events`)).status, 401);
  assert.equal((await fetch(`${base}/auth/events?secret=wrong`)).status, 401);

  const ac = new AbortController();
  t.after(() => ac.abort());
  const res = await fetch(`${base}/auth/events?secret=launch-secret`, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const next = reader(res);
  assert.deepEqual(await next(), {
    phase: 'idle',
    connected: false,
    expired: false,
    unverified: false,
    moodleBusy: false,
  });

  // The header works too, for a non-browser caller.
  const viaHeader = await fetch(`${base}/auth/events`, {
    headers: { 'X-FastStudy-Secret': 'launch-secret' },
    signal: ac.signal,
  });
  assert.equal(viaHeader.status, 200);

  // A retry through POST /auth/complete: a dead token, then success, each announced. (A block
  // would open a real challenge window.)
  writeTokenFile(TOKEN_FILE, { site: SITE, wstoken: 'w', userid: null, unverified: true });
  const answers = [
    {
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ exception: 'x', errorcode: 'invalidtoken', message: 'bad' }),
    },
    { status: 200, headers: { get: () => 'application/json' }, json: async () => GOOD },
  ];
  const local = fetch; // the real one, for calls to this test's own server
  t.mock.method(globalThis, 'fetch', async () => answers.shift());
  assert.equal(
    (await local(`${base}/auth/complete`, { method: 'POST', headers: hdr() })).status,
    401,
  );
  // The lock is taken at the site-info call, the failure lands under it, then the lock frees.
  assert.equal((await next()).moodleBusy, true);
  const dead = await next();
  assert.equal(dead.phase, 'idle');
  assert.equal(dead.moodleBusy, true);
  assert.deepEqual(dead.error, { code: 'moodle_reconnect_required', params: {} });
  const freed = await next();
  assert.deepEqual([freed.moodleBusy, freed.error?.code], [false, 'moodle_reconnect_required']);

  writeTokenFile(TOKEN_FILE, { site: SITE, wstoken: 'w', userid: null, unverified: true });
  assert.equal(
    (await local(`${base}/auth/complete`, { method: 'POST', headers: hdr() })).status,
    200,
  );
  assert.equal((await next()).moodleBusy, true);
  const done = await next();
  assert.deepEqual(done, {
    phase: 'connected',
    connected: true,
    expired: false,
    unverified: false,
    moodleBusy: true,
  });
  assert.equal((await next()).moodleBusy, false);
});

function hdr() {
  return { 'X-FastStudy-Secret': 'launch-secret' };
}
