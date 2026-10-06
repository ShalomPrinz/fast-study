// The configured Moodle site: which roots a pasted link can mean, what the pre-login probe makes of
// each answer (a bot wall is never "not Moodle"), and how POST /config swaps sites.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// An empty state root, so /config's token reset acts on a file planted here and never the developer's.
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-site-'));
process.env.FASTSTUDY_STATE_DIR = STATE_DIR;
const TOKEN_FILE = path.join(STATE_DIR, 'auth', 'moodle-token.json');
process.on('exit', () => fs.rmSync(STATE_DIR, { recursive: true, force: true }));

import { candidateRoots, currentSite, setCurrentSite, underSite } from '../src/moodle/site.js';
import { probeSite } from '../src/moodle/probe.js';
import { handleAuthStatus, handleConfig, handleList, handleSiteProbe } from '../src/http/server.js';

// Enough of an Express response for the handlers' send(): records the status and the body.
function fakeRes() {
  const res = {
    code: null,
    body: null,
    status(code) {
      res.code = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

// Route each probed root to an answer: a function of the root, returning a Response stand-in or throwing.
function stubFetch(t, answer) {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  const asked = [];
  globalThis.fetch = async (url) => {
    const root = String(url).replace(/\/lib\/ajax\/service-nologin\.php.*$/, '');
    asked.push(root);
    return answer(root);
  };
  return asked;
}

const reply = (status, type, body) => ({
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});
const config = (data) => reply(200, 'application/json', [{ error: false, data }]);
const MOODLE = {
  wwwroot: 'https://x.ac.il/moodle',
  enablemobilewebservice: 1,
  maintenanceenabled: 0,
};
const NOT_FOUND = reply(404, 'text/html; charset=utf-8', '<html>404</html>');
const BOT_WALL = reply(200, 'text/html; charset=utf-8', '<html>Radware Captcha Page</html>');

// ── candidate roots ─────────────────────────────────────────────────────────

test('a pasted course link yields the origin, then the prefix before /course/', () => {
  assert.deepEqual(candidateRoots('https://x.ac.il/moodle/course/view.php?id=5'), [
    'https://x.ac.il',
    'https://x.ac.il/moodle',
  ]);
  assert.deepEqual(candidateRoots('https://lemida.biu.ac.il/course/view.php?id=1'), [
    'https://lemida.biu.ac.il',
  ]);
  assert.deepEqual(candidateRoots('x.ac.il/m/login/index.php'), [
    'https://x.ac.il',
    'https://x.ac.il/m',
  ]);
  assert.deepEqual(candidateRoots('https://x.ac.il/moodle/'), [
    'https://x.ac.il',
    'https://x.ac.il/moodle',
  ]);
  assert.deepEqual(candidateRoots('https://x.ac.il/'), ['https://x.ac.il']);
  assert.deepEqual(candidateRoots('ftp://x.ac.il'), []);
  assert.deepEqual(candidateRoots('not a url'), []);
});

test('a URL is under a site by origin and path prefix, never by a look-alike path', () => {
  assert.equal(
    underSite('https://x.ac.il/moodle/course/view.php?id=1', 'https://x.ac.il/moodle'),
    true,
  );
  assert.equal(
    underSite('https://x.ac.il/moodle2/course/view.php', 'https://x.ac.il/moodle'),
    false,
  );
  assert.equal(
    underSite('https://y.ac.il/moodle/course/view.php', 'https://x.ac.il/moodle'),
    false,
  );
  assert.equal(underSite('https://x.ac.il/anything', 'https://x.ac.il'), true);
});

// ── the probe ───────────────────────────────────────────────────────────────

test('a Moodle with the mobile service on is supported, at its own wwwroot', async (t) => {
  const asked = stubFetch(t, (root) =>
    root === 'https://x.ac.il/moodle' ? config(MOODLE) : NOT_FOUND,
  );
  assert.deepEqual(await probeSite('https://x.ac.il/moodle/course/view.php?id=5'), {
    status: 'supported',
    site: 'https://x.ac.il/moodle',
  });
  assert.deepEqual(asked, ['https://x.ac.il', 'https://x.ac.il/moodle']);
});

test('the mobile service off, and maintenance, are unsupported with their reason', async (t) => {
  stubFetch(t, () => config({ ...MOODLE, enablemobilewebservice: 0 }));
  assert.deepEqual(await probeSite('https://x.ac.il/moodle'), {
    status: 'unsupported',
    site: 'https://x.ac.il/moodle',
    code: 'moodle_site_unsupported',
    params: { site: 'https://x.ac.il/moodle', reason: 'mobile_service_off' },
  });
  globalThis.fetch = async () => config({ ...MOODLE, maintenanceenabled: 1 });
  assert.equal((await probeSite('https://x.ac.il/moodle')).params.reason, 'maintenance');
});

test('a Moodle exception envelope reads as the mobile service off', async (t) => {
  stubFetch(t, () =>
    reply(200, 'application/json', [
      { error: true, exception: { errorcode: 'servicenotavailable', message: 'x' } },
    ]),
  );
  assert.equal((await probeSite('https://x.ac.il')).params.reason, 'mobile_service_off');
});

test('every root answering without Moodle JSON is not_moodle', async (t) => {
  stubFetch(t, (root) =>
    root === 'https://x.ac.il' ? NOT_FOUND : reply(200, 'application/json', { hello: 1 }),
  );
  assert.deepEqual(await probeSite('https://x.ac.il/m/course/view.php?id=1'), {
    status: 'unsupported',
    site: 'https://x.ac.il',
    code: 'moodle_site_unsupported',
    params: { site: 'https://x.ac.il', reason: 'not_moodle' },
  });
});

test('an HTML bot wall is unverified, never not_moodle', async (t) => {
  stubFetch(t, () => BOT_WALL);
  assert.deepEqual(await probeSite('https://x.ac.il'), {
    status: 'unverified',
    site: 'https://x.ac.il',
    params: { site: 'https://x.ac.il', detail: 'site_blocked' },
  });
  // One unreachable root is enough: "none is Moodle" can no longer be proved.
  globalThis.fetch = async (url) =>
    String(url).startsWith('https://x.ac.il/m/') ? BOT_WALL : NOT_FOUND;
  assert.equal((await probeSite('https://x.ac.il/m/course/view.php')).status, 'unverified');
});

test('a network failure or a timeout is unverified with what failed', async (t) => {
  stubFetch(t, () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual((await probeSite('https://x.ac.il')).params, {
    site: 'https://x.ac.il',
    detail: 'network',
  });
  globalThis.fetch = async () => {
    throw new DOMException('timed out', 'TimeoutError');
  };
  assert.equal((await probeSite('https://x.ac.il')).params.detail, 'timeout');
});

// A 3xx carrying `location` and `type`, with `body` as its JSON (Ariel's 302 carries Moodle's own).
const redirect = (status, location, type = 'text/html', body = null) => ({
  status,
  headers: {
    get: (h) => ({ 'content-type': type, location })[h.toLowerCase()] ?? null,
  },
  json: async () => body,
});

test('a redirect to a Moodle is followed once, and the target decides', async (t) => {
  // Technion's shape: a 301 off the stable address to the per-year host's endpoint.
  const asked = stubFetch(t, (root) =>
    root === 'https://moodle.technion.ac.il'
      ? redirect(
          301,
          'https://moodle26.technion.ac.il/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config',
        )
      : config({ ...MOODLE, wwwroot: 'https://moodle26.technion.ac.il' }),
  );
  assert.deepEqual(await probeSite('https://moodle.technion.ac.il'), {
    status: 'supported',
    site: 'https://moodle26.technion.ac.il',
  });
  assert.deepEqual(asked, ['https://moodle.technion.ac.il', 'https://moodle26.technion.ac.il']);

  // Ariel's shape: a 302 whose body is Moodle's own error JSON, to a prefixed site with mobile off.
  const target = 'https://moodlearn.ariel.ac.il/moodlestandalone';
  globalThis.fetch = async (url) =>
    String(url).startsWith(target)
      ? config({ ...MOODLE, wwwroot: target, enablemobilewebservice: 0 })
      : redirect(302, `${target}/`, 'application/json', {
          error: 'x',
          errorcode: 'redirecterrordetected',
        });
  assert.deepEqual(await probeSite('https://moodle.ariel.ac.il'), {
    status: 'unsupported',
    site: target,
    code: 'moodle_site_unsupported',
    params: { site: target, reason: 'mobile_service_off' },
  });
});

test('a redirect to a relative Location resolves against the request', async (t) => {
  const asked = stubFetch(t, (root) =>
    root === 'https://x.ac.il' ? redirect(302, '/moodle/') : config(MOODLE),
  );
  assert.equal((await probeSite('https://x.ac.il')).site, 'https://x.ac.il/moodle');
  assert.deepEqual(asked, ['https://x.ac.il', 'https://x.ac.il/moodle']);
});

test('a second redirect, or a redirect to HTML, stays unverified', async (t) => {
  const asked = stubFetch(t, (root) => redirect(302, `${root}/next`));
  assert.deepEqual(await probeSite('https://x.ac.il'), {
    status: 'unverified',
    site: 'https://x.ac.il',
    params: { site: 'https://x.ac.il', detail: 'site_blocked' },
  });
  assert.deepEqual(asked, ['https://x.ac.il', 'https://x.ac.il/next']);

  globalThis.fetch = async (url) =>
    String(url).startsWith('https://x.ac.il/') ? redirect(302, 'https://wall.example/') : BOT_WALL;
  assert.equal((await probeSite('https://x.ac.il')).params.detail, 'site_blocked');
  // A redirect's target that answers 404 is no proof either: the redirect itself was the answer.
  globalThis.fetch = async (url) =>
    String(url).startsWith('https://x.ac.il/') ? redirect(302, 'https://y.ac.il/') : NOT_FOUND;
  assert.equal((await probeSite('https://x.ac.il')).status, 'unverified');
});

test('POST /site/probe answers the verdict, and 400 without a URL', async (t) => {
  stubFetch(t, () => config({ ...MOODLE, wwwroot: 'https://x.ac.il/moodle/' }));
  const res = fakeRes();
  await handleSiteProbe({ body: { url: 'https://x.ac.il/moodle/my/' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { status: 'supported', site: 'https://x.ac.il/moodle' });

  const bad = fakeRes();
  await handleSiteProbe({ body: {} }, bad);
  assert.equal(bad.code, 400);
  assert.deepEqual(
    { code: bad.body.code, params: bad.body.params },
    {
      code: 'invalid_request',
      params: { field: 'url' },
    },
  );
});

// ── POST /config ────────────────────────────────────────────────────────────

const plantToken = (site) => {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ site, wstoken: 'tok', privatetoken: 'p', userid: 7 }),
  );
};

test('with no site configured, auth and listing answer moodle_site_not_configured', async () => {
  setCurrentSite(null);
  const status = fakeRes();
  handleAuthStatus({}, status);
  assert.equal(status.code, 409);
  assert.equal(status.body.code, 'moodle_site_not_configured');
  const list = fakeRes();
  await handleList({ body: { courseUrl: 'https://x.ac.il/course/view.php?id=1' } }, list);
  assert.equal(list.code, 409);
  assert.equal(list.body.code, 'moodle_site_not_configured');
});

test('the same site is a no-op; another one forgets the token', async () => {
  const A = 'https://a.ac.il';
  setCurrentSite(A);
  plantToken(A);
  const same = fakeRes();
  await handleConfig({ body: { moodle_site: `${A}/` } }, same);
  assert.deepEqual([same.code, same.body], [200, { status: 'ok', applied: ['moodle_site'] }]);
  assert.equal(fs.existsSync(TOKEN_FILE), true);
  const connected = fakeRes();
  handleAuthStatus({}, connected);
  assert.deepEqual(connected.body, { connected: true, expired: false, unverified: false });

  const other = fakeRes();
  await handleConfig({ body: { moodle_site: 'https://b.ac.il/moodle' } }, other);
  assert.equal(other.code, 200);
  assert.equal(currentSite(), 'https://b.ac.il/moodle');
  assert.equal(fs.existsSync(TOKEN_FILE), false);
  const after = fakeRes();
  handleAuthStatus({}, after);
  assert.deepEqual(after.body, { connected: false, expired: false, unverified: false });

  // A course on the old site is now another site's.
  const list = fakeRes();
  await handleList({ body: { courseUrl: `${A}/course/view.php?id=1` } }, list);
  assert.equal(list.code, 400);
  assert.deepEqual(
    { code: list.body.code, params: list.body.params },
    {
      code: 'course_url_unsupported_site',
      params: { url: `${A}/course/view.php?id=1`, site: 'https://b.ac.il/moodle' },
    },
  );
});

test('POST /config leaves an omitted site alone and refuses a non-URL', async () => {
  setCurrentSite('https://a.ac.il');
  const omitted = fakeRes();
  await handleConfig({ body: {} }, omitted);
  assert.deepEqual(omitted.body, { status: 'ok', applied: [] });
  assert.equal(currentSite(), 'https://a.ac.il');

  for (const value of ['not a url', 42]) {
    const bad = fakeRes();
    await handleConfig({ body: { moodle_site: value } }, bad);
    assert.equal(bad.code, 400);
    assert.deepEqual(
      { code: bad.body.code, params: bad.body.params },
      {
        code: 'invalid_request',
        params: { field: 'moodle_site' },
      },
    );
  }
  assert.equal(currentSite(), 'https://a.ac.il');

  const cleared = fakeRes();
  await handleConfig({ body: { moodle_site: '' } }, cleared);
  assert.equal(cleared.code, 200);
  assert.equal(currentSite(), null);
});
