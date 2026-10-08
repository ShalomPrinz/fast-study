// An unsupported site reaches Sentry once per (host, reason), never for a probe it could not finish.
// The transport is stubbed, so nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FASTSTUDY_SENTRY_DSN = 'https://public@o0.ingest.de.sentry.io/0';
process.env.FASTSTUDY_ERROR_REPORTS = '1';
const Sentry = await import('@sentry/node');
await import('../instrument.js');
const { handleSiteProbe } = await import('../src/http/server.js');
const { reportUnsupportedSite } = await import('../siteReport.js');
await import('./gated.js'); // no cooldown between the probes below

const events = [];
const client = Sentry.getClient();
client.on('beforeEnvelope', (envelope) => {
  for (const [header, item] of envelope[1]) if (header.type === 'event') events.push(item);
});
client.getTransport().send = async () => ({});

const res = () => ({ status: () => ({ json: () => {} }), on: () => {} });
const reply = (status, type, body) => ({
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
  json: async () => body,
});

async function probe(t, answer, url) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = async () => answer;
  await handleSiteProbe({ body: { url } }, res());
  await Sentry.flush(2000);
}

const byReason = (reason) => events.filter((e) => e.tags.moodle_reason === reason);

test('an unsupported probe is sent once per host and reason, tagged', async (t) => {
  const off = reply(200, 'application/json', [
    { error: false, data: { wwwroot: 'https://off.ac.il', enablemobilewebservice: 0 } },
  ]);
  await probe(t, off, 'https://off.ac.il/course/view.php?id=1');
  await probe(t, off, 'https://off.ac.il/');
  const sent = byReason('mobile_service_off');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message, 'moodle_site_unsupported');
  assert.equal(sent[0].level, 'warning');
  assert.equal(sent[0].tags.moodle_host, 'off.ac.il');
  assert.equal(sent[0].tags.moodle_stage, 'probe');

  await probe(t, reply(404, 'text/html', null), 'https://off.ac.il/');
  assert.equal(
    byReason('not_moodle').length,
    1,
    'another reason on the same host is its own event',
  );
});

test('an unverified probe is never sent', async (t) => {
  const before = events.length;
  await probe(t, reply(200, 'text/html', null), 'https://walled.ac.il/');
  assert.equal(events.length, before);
});

test('a login-stage report carries the site release', async () => {
  reportUnsupportedSite({
    site: 'https://login.ac.il/moodle',
    stage: 'login',
    reason: 'autologin_unavailable',
    release: '4.5.10 (Build: 20250414)',
  });
  reportUnsupportedSite({
    site: 'https://login.ac.il/moodle',
    stage: 'login',
    reason: 'autologin_unavailable',
  });
  await Sentry.flush(2000);
  const sent = byReason('autologin_unavailable');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tags.moodle_stage, 'login');
  assert.equal(sent[0].tags.moodle_host, 'login.ac.il');
  assert.equal(sent[0].extra.release, '4.5.10 (Build: 20250414)');
});
