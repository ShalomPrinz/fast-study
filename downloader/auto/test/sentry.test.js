// instrument.js wiring: a route error reaches Sentry tagged with this service and scrubbed, and the
// response is still the app's own. The transport is stubbed, so nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.FASTSTUDY_SENTRY_DSN = 'https://public@o0.ingest.de.sentry.io/0';
process.env.FASTSTUDY_ERROR_REPORTS = '1';
const Sentry = await import('@sentry/node');
await import('../instrument.js');
const { handleConfig } = await import('../src/http/server.js');

test('a route error is captured tagged service=auto with its Hebrew path scrubbed', async () => {
  const client = Sentry.getClient();
  assert.ok(client, 'instrument.js initialised the SDK');
  const events = [];
  client.on('beforeEnvelope', (envelope) => {
    for (const [header, item] of envelope[1]) if (header.type === 'event') events.push(item);
  });
  client.getTransport().send = async () => ({});

  const app = express();
  app.get('/boom', () => {
    throw new Error('cannot open /data/קורס/הרצאה 1/video.mp4');
  });
  Sentry.setupExpressErrorHandler(app);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/boom`);
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /הרצאה/, 'the response itself is untouched');
  } finally {
    server.close();
  }
  await Sentry.flush(2000);

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.tags.service, 'auto');
  const value = event.exception.values[0].value;
  assert.equal(value, 'cannot open <path>/video.mp4');
});

test('POST /config error_reports switches sending off and back on live', async () => {
  const client = Sentry.getClient();
  const events = [];
  client.on('beforeEnvelope', (envelope) => {
    for (const [header, item] of envelope[1]) if (header.type === 'event') events.push(item);
  });
  client.getTransport().send = async () => ({});

  const app = express();
  app.use(express.json());
  app.post('/config', handleConfig);
  app.get('/boom', () => {
    throw new Error('boom');
  });
  Sentry.setupExpressErrorHandler(app);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = (body) =>
    fetch(`${base}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const boom = async () => {
    await fetch(`${base}/boom`);
    await Sentry.flush(2000);
  };
  try {
    const bad = await config({ error_reports: 1 });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'invalid_request');

    const off = await config({ error_reports: false });
    assert.equal(off.status, 200);
    assert.deepEqual((await off.json()).applied, ['error_reports']);
    await boom();
    assert.equal(events.length, 0, 'nothing is sent while off');

    assert.equal((await config({ error_reports: true })).status, 200);
    await boom();
    assert.equal(events.length, 1, 'sending resumes without a restart');
  } finally {
    server.close();
  }
});
