// The channel probe: one headless launch per channel answers both "installed?" and the UA the
// challenge window launches with (docs/SESSIONS.md). Playwright's chromium is stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBrowserChannel,
  resolveUserAgent,
  configureBrowserChannel,
} from '../src/browser/browserChannel.js';

const HEADLESS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36';

// A chromium whose `installed` channels launch; `ua` is what the page reports (a throw when null).
function fakeChromium({ installed, ua = HEADLESS_UA }) {
  const launches = [];
  const state = { ua };
  const chromium = {
    launch: async ({ channel, headless }) => {
      launches.push({ channel, headless });
      if (!installed.includes(channel))
        throw new Error(`Chromium distribution '${channel}' is not found at /x\nRun install`);
      return {
        newPage: async () => ({
          evaluate: async () => {
            if (state.ua == null) throw new Error('page crashed');
            return state.ua;
          },
        }),
        close: async () => {},
      };
    },
  };
  return { chromium, launches, state };
}

test('the probe reports the channel with its UA as a headed launch sends it', async (t) => {
  const fake = fakeChromium({ installed: ['chrome'] });
  t.after(configureBrowserChannel({ chromium: async () => fake.chromium }));
  const r = await resolveBrowserChannel();
  assert.deepEqual(r, {
    channel: 'chrome',
    browser: 'Google Chrome',
    userAgent: HEADLESS_UA.replace('HeadlessChrome', 'Chrome'),
  });
  assert.deepEqual(fake.launches, [{ channel: 'chrome', headless: true }]);
  // Cached with the channel: no second launch.
  assert.equal(await resolveBrowserChannel(), r);
  assert.equal(fake.launches.length, 1);
});

test('a UA the page cannot report leaves the channel resolved with a null UA', async (t) => {
  const fake = fakeChromium({ installed: ['msedge'], ua: null });
  t.after(configureBrowserChannel({ chromium: async () => fake.chromium }));
  const r = await resolveBrowserChannel();
  assert.equal(r.channel, 'msedge');
  assert.equal(r.userAgent, null);
});

test('no installed channel throws browser_missing, naming each first line', async (t) => {
  const fake = fakeChromium({ installed: [] });
  t.after(configureBrowserChannel({ chromium: async () => fake.chromium }));
  await assert.rejects(resolveBrowserChannel(), (err) => {
    assert.equal(err.code, 'browser_missing');
    assert.match(err.params.detail, /^chrome: .*\/x \| msedge: /);
    assert.doesNotMatch(err.params.detail, /Run install/);
    return true;
  });
});

test('a null UA is never cached: the next ask re-probes the channel and keeps the answer', async (t) => {
  const fake = fakeChromium({ installed: ['chrome'], ua: null });
  t.after(configureBrowserChannel({ chromium: async () => fake.chromium }));
  // The chain probe and one retry both fail to read it.
  assert.equal(await resolveUserAgent(), null);
  assert.equal(fake.launches.length, 2);
  // The channel stays cached for the launchers that only need it.
  assert.equal((await resolveBrowserChannel()).channel, 'chrome');
  assert.equal(fake.launches.length, 2);
  fake.state.ua = HEADLESS_UA;
  const ua = HEADLESS_UA.replace('HeadlessChrome', 'Chrome');
  assert.equal(await resolveUserAgent(), ua);
  assert.equal(fake.launches.length, 3);
  assert.equal(await resolveUserAgent(), ua);
  assert.equal((await resolveBrowserChannel()).userAgent, ua);
  assert.equal(fake.launches.length, 3);
});
