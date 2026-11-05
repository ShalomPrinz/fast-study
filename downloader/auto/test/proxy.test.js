import test from 'node:test';
import assert from 'node:assert/strict';
import { startProxyDetection, proxyKind, resetProxyKind } from '../src/lib/proxy.js';
import { unreachable, fetchUpstream, pageUnreachable, networkTags } from '../src/lib/errors.js';

const REG = (body) => () =>
  Promise.resolve(`\r\nHKEY_CURRENT_USER\\...\\Internet Settings\r\n${body}\r\n`);
const detect = async (body, platform = 'win32') => {
  resetProxyKind();
  await startProxyDetection({ platform, readRegistry: REG(body) });
  return proxyKind({});
};

test('env proxy in either case wins, empty value does not count', () => {
  resetProxyKind();
  assert.equal(proxyKind({ https_proxy: 'http://p:1' }), 'env');
  assert.equal(proxyKind({ ALL_PROXY: 'socks5://p' }), 'env');
  assert.equal(proxyKind({ HTTP_PROXY: '' }), null);
  assert.equal(proxyKind({ NO_PROXY: '*' }), null);
});

test('windows registry: ProxyEnable=1 or AutoConfigURL is system', async (t) => {
  t.after(resetProxyKind);
  assert.equal(await detect('    ProxyEnable    REG_DWORD    0x1'), 'system');
  assert.equal(await detect('    ProxyEnable    REG_DWORD    0x0'), null);
  assert.equal(await detect('    AutoConfigURL    REG_SZ    http://wpad/proxy.pac'), 'system');
  assert.equal(await detect('    AutoConfigURL    REG_SZ    '), null);
});

test('pending read answers env-or-null, then the settled value', async (t) => {
  t.after(resetProxyKind);
  resetProxyKind();
  let release;
  const readRegistry = () =>
    new Promise((r) => {
      release = () => r('ProxyEnable REG_DWORD 0x1');
    });
  const done = startProxyDetection({ platform: 'win32', readRegistry });
  assert.equal(proxyKind({}), null);
  assert.equal(proxyKind({ HTTPS_PROXY: 'http://p:1' }), 'env');
  release();
  await done;
  assert.equal(proxyKind({}), 'system');
  assert.equal(proxyKind({ HTTPS_PROXY: 'http://p:1' }), 'env');
});

test('registry is not read off Windows, and a failing read is no proxy, not retried', async (t) => {
  t.after(resetProxyKind);
  let reads = 0;
  const readRegistry = () => ((reads += 1), Promise.resolve('ProxyEnable REG_DWORD 0x1'));
  resetProxyKind();
  await startProxyDetection({ platform: 'linux', readRegistry });
  assert.equal(reads, 0);
  assert.equal(proxyKind({}), null);

  let tries = 0;
  const boom = () => ((tries += 1), Promise.reject(new Error('timed out')));
  await startProxyDetection({ platform: 'win32', readRegistry: boom });
  assert.equal(proxyKind({}), null);
  assert.equal(proxyKind({}), null);
  assert.equal(tries, 1);
});

test('site_unreachable carries proxy only when one is detected; Sentry tags say none/env', async (t) => {
  const saved = { ...process.env };
  t.after(() => {
    for (const k of ['HTTPS_PROXY', 'https_proxy']) delete process.env[k];
    Object.assign(process.env, saved);
    resetProxyKind();
  });
  const failing = async () => {
    const e = new TypeError('fetch failed');
    e.cause = new Error('connect ETIMEDOUT');
    throw e;
  };
  const real = globalThis.fetch;
  globalThis.fetch = failing;
  t.after(() => (globalThis.fetch = real));
  const err = await fetchUpstream('https://moodle.test/x').catch((e) => e);
  assert.equal(err.route, 'node');

  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
    delete process.env[k];
    delete process.env[k.toLowerCase()];
  }
  if (process.platform === 'win32') return;
  resetProxyKind();
  assert.deepEqual(unreachable(err).params, { host: 'moodle.test', detail: 'connect ETIMEDOUT' });
  assert.deepEqual(networkTags(err), { proxy: 'none', route: 'node' });

  process.env.HTTPS_PROXY = 'http://p:1';
  resetProxyKind();
  assert.equal(proxyKind(), 'env');
  assert.equal(unreachable(err).params.proxy, 'env');
  assert.deepEqual(networkTags(err), { proxy: 'env', route: 'node' });
});

test('a window-route failure is tagged route=window; non-network errors get no tags', () => {
  assert.equal(networkTags(pageUnreachable('https://m.test/a', 'net::ERR_X')).route, 'window');
  assert.equal(networkTags(new Error('boom')), null);
});
