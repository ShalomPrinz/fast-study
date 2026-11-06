// A Moodle 5xx is a server fault, never the bot wall: one resend inside the lock after the gate's
// cooldown, then `moodle_upstream_error`. A 200 text/html or a 302 stays `site_blocked`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCourseContents, WsBlockedError, MoodleUpstreamError } from '../src/moodle/wsClient.js';
import { challengeRoute } from '../src/moodle/challenge.js';
import { setCurrentSite } from '../src/moodle/site.js';
import { moodleGate, enterMoodle } from '../src/moodle/gate.js';
import { gated } from './gated.js';

const SITE = 'https://moodle.test';
setCurrentSite(SITE);

const html = (status) =>
  new Response('<html>Bad Gateway</html>', { status, headers: { 'content-type': 'text/html' } });
const ok = () =>
  new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

// Replaces fetch with `answers` in order (the last repeats); → the calls seen.
function stub(t, answers, onCall = () => {}) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  const calls = [];
  globalThis.fetch = async () => {
    calls.push(calls.length);
    onCall(calls.length);
    const make = answers[Math.min(calls.length, answers.length) - 1];
    return make();
  };
  return calls;
}

const fails = (fn) =>
  gated(fn).then(
    () => null,
    (e) => e,
  );
const call = () => getCourseContents(SITE, 'tok', '1');

test('a 502 HTML then a 200 succeeds after one resend, with no block mode', async (t) => {
  const calls = stub(t, [() => html(502), ok]);
  assert.deepEqual(await gated(call), []);
  assert.equal(calls.length, 2);
  assert.equal(challengeRoute(`${SITE}/webservice/rest/server.php`), null);
});

test('a 502 twice is moodle_upstream_error, not site_blocked', async (t) => {
  const calls = stub(t, [() => html(502)]);
  const err = await fails(call);
  assert.ok(err instanceof MoodleUpstreamError);
  assert.equal(err.code, 'moodle_upstream_error');
  assert.deepEqual(err.params, { detail: 'HTTP 502, text/html' });
  assert.equal(calls.length, 2);
  assert.equal(challengeRoute(`${SITE}/webservice/rest/server.php`), null);
});

test('a 5xx with a JSON body follows the same rule', async (t) => {
  const json = () =>
    new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  const calls = stub(t, [json]);
  const err = await fails(call);
  assert.equal(err.code, 'moodle_upstream_error');
  assert.equal(calls.length, 2);
});

test('the resend waits the cooldown and keeps the lock', async (t) => {
  const prev = moodleGate.cooldownMs;
  moodleGate.cooldownMs = 60;
  t.after(() => {
    moodleGate.cooldownMs = prev;
  });
  const events = [];
  const started = Date.now();
  let second = 0;
  const calls = stub(t, [() => html(502), ok], (n) => {
    events.push(`fetch${n}`);
    if (n === 2) second = Date.now() - started;
  });
  const a = gated(call);
  await new Promise((r) => setTimeout(r, 10));
  const b = moodleGate.run({ wait: true }, async () => {
    await enterMoodle('b');
    events.push('other');
  });
  await Promise.all([a, b]);
  assert.equal(calls.length, 2);
  assert.ok(second >= 55, `resent after ${second}ms`);
  assert.deepEqual(events, ['fetch1', 'fetch2', 'other']);
});

test('an abort during the cooldown sleep stops the call', async (t) => {
  const prev = moodleGate.cooldownMs;
  moodleGate.cooldownMs = 5000;
  t.after(() => {
    moodleGate.cooldownMs = prev;
  });
  const calls = stub(t, [() => html(502), ok]);
  await new Promise((r) => setTimeout(r, 80)); // the previous test's cooldown ends first
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(new Error('hung up')), 20);
  const err = await moodleGate.run({ wait: true, signal: ctl.signal }, call).then(
    () => null,
    (e) => e,
  );
  assert.equal(err?.message, 'hung up');
  assert.equal(calls.length, 1);
});

test('a 200 text/html and a 302 are still site_blocked', async (t) => {
  const page = () =>
    new Response('<html>captcha</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  stub(t, [page]);
  assert.ok((await fails(call)) instanceof WsBlockedError);
  const redirect = () => new Response(null, { status: 302, headers: { location: `${SITE}/c` } });
  stub(t, [redirect]);
  assert.ok((await fails(call)) instanceof WsBlockedError);
});
