const assert = require('node:assert/strict');
const http = require('node:http');
const { afterEach, beforeEach, test } = require('node:test');

const stub = require('./stubElectron');
const store = require('../store');
const { pushReports, reportsOn, sentryEnv, writeSettings } = require('../reports');

const SECRET = 'launch-secret';
const servers = [];

beforeEach(() => stub.useTempUserData());
afterEach(async () => {
  stub.cleanup();
  await Promise.all(servers.splice(0).map((server) => new Promise((r) => server.close(r))));
});

/** A local `/config` that answers `status` (or never, for `null`) and records what it was sent. */
async function configService(status) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({
        url: req.url,
        secret: req.headers['x-faststudy-secret'],
        body: JSON.parse(body),
      });
      if (status !== null) res.writeHead(status).end('{}');
    });
  });
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, server };
}

function deps(urls, calls = []) {
  return { urls, secret: SECRET, setReporting: (on) => calls.push(on), log: () => {} };
}

test('an unset switch is off at launch, and only an explicit true turns it on', () => {
  assert.equal(reportsOn(), false);
  assert.equal(sentryEnv('https://k@sentry/1').FASTSTUDY_ERROR_REPORTS, '0');
  store.write({ errorReports: false });
  assert.equal(reportsOn(), false);
  store.write({ errorReports: true });
  assert.equal(reportsOn(), true);
});

test('the child env carries the DSN either way and the flag from the store at each call', () => {
  const dsn = 'https://k@sentry/1';
  assert.deepEqual(sentryEnv(dsn), { FASTSTUDY_SENTRY_DSN: dsn, FASTSTUDY_ERROR_REPORTS: '0' });
  store.write({ errorReports: true });
  assert.deepEqual(sentryEnv(dsn), { FASTSTUDY_SENTRY_DSN: dsn, FASTSTUDY_ERROR_REPORTS: '1' });
  store.write({ errorReports: false });
  assert.deepEqual(sentryEnv(''), { FASTSTUDY_SENTRY_DSN: '', FASTSTUDY_ERROR_REPORTS: '0' });
});

test('a switch change reaches main and all four services, secret attached', async () => {
  const services = await Promise.all([200, 200, 200, 200].map(configService));
  const [database, backend, autoDownloader, downloadServer] = services.map((s) => s.url);
  const calls = [];

  const result = await writeSettings(
    { errorReports: true },
    deps({ database, backend, autoDownloader, downloadServer }, calls),
  );

  assert.equal(result.errorReports, true);
  assert.equal(result.errorReportsRestartNeeded, false);
  assert.deepEqual(calls, [true]);
  for (const { seen } of services) {
    assert.deepEqual(seen, [{ url: '/config', secret: SECRET, body: { error_reports: true } }]);
  }
});

test('a service that refuses or is down needs a restart, and the save still lands', async () => {
  const ok = await configService(200);
  const refusing = await configService(404);
  const calls = [];

  const result = await writeSettings(
    { errorReports: true, dataRoot: '/data/root' },
    deps({ database: ok.url, backend: ok.url, autoDownloader: refusing.url }, calls),
  );

  assert.equal(result.errorReportsRestartNeeded, true);
  assert.equal(result.dataRoot, '/data/root');
  assert.equal(store.read().errorReports, true);
  assert.deepEqual(calls, [true]);
});

test('a service slower than the timeout counts as missed', async () => {
  const hung = await configService(null);
  const missed = await pushReports(
    { database: hung.url, backend: hung.url, autoDownloader: hung.url, downloadServer: hung.url },
    SECRET,
    false,
    100,
  );
  assert.equal(missed.length, 4);
  assert.match(missed[0], /database \(timed out\)/);
  hung.server.closeAllConnections();
});

test('a patch without the switch touches no service and needs no restart', async () => {
  const service = await configService(200);
  const calls = [];

  const result = await writeSettings(
    { privacyConfirmed: true },
    deps({ database: service.url }, calls),
  );

  assert.equal(result.privacyConfirmed, true);
  assert.equal(result.errorReportsRestartNeeded, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(service.seen, []);
});

test('a refused patch rejects, and the next write still runs', async () => {
  await assert.rejects(writeSettings({ errorReports: 'yes' }, deps({})), /must be a boolean/);
  const result = await writeSettings({ privacyConfirmed: true }, deps({}));
  assert.equal(result.privacyConfirmed, true);
});

test('concurrent writes reach the services in the order they were made', async () => {
  const service = await configService(200);
  const urls = {
    database: service.url,
    backend: service.url,
    autoDownloader: service.url,
    downloadServer: service.url,
  };

  const [first, second] = await Promise.all([
    writeSettings({ errorReports: true }, deps(urls)),
    writeSettings({ errorReports: false }, deps(urls)),
  ]);

  assert.equal(first.errorReports, true);
  assert.equal(second.errorReports, false);
  assert.deepEqual(
    service.seen.map((s) => s.body.error_reports),
    [true, true, true, true, false, false, false, false],
  );
});
