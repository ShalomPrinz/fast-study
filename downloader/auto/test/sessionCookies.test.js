// The saved Moodle session: only session cookies, encrypted like the token, scoped to one site, and
// tied to the stored token's user, gone with the Moodle browser's profile (disconnect, a login
// replacing another site's token) and on a new login, but kept across POST /close and a site switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { statePath } from '@faststudy/runtime';
import { writeTokenFile, tokenPath } from '../src/auth/tokenStore.js';
import {
  saveSessionCookies,
  loadSessionCookies,
  forgetSessionCookies,
} from '../src/auth/sessionCookies.js';
import { setSite, siteAuth, authState, authEvents } from '../src/core/registry.js';
import { handleClose } from '../src/http/server.js';
import { MoodleToken } from '../src/auth/moodleToken.js';
import { gated } from './gated.js';
import { profileDir } from '../src/moodle/challenge.js';

const SITE = 'https://moodle.test';
const FILE = statePath('auth', 'moodle-session.json');
const SESSION = {
  name: 'MoodleSessionprod',
  value: 'secret-session-value',
  domain: 'moodle.test',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
};
// A bot-manager cookie: persistent, so the profile already keeps it and putting it back as a session
// cookie would cut its life short.
const RADWARE = { name: '__uzma', value: 'r', domain: 'moodle.test', path: '/', expires: 1.8e9 };

const signIn = (userid, site = SITE) => writeTokenFile(tokenPath(), { site, wstoken: 'w', userid });

test.beforeEach(() => signIn(7));
test.afterEach(() => {
  forgetSessionCookies();
  fs.rmSync(tokenPath(), { force: true });
});

test('keeps only session cookies, with what addCookies needs and no expiry', () => {
  saveSessionCookies(SITE, [SESSION, RADWARE]);
  const { expires: _expires, ...kept } = SESSION;
  assert.deepEqual(loadSessionCookies(SITE), [kept]);
});

test('another site, nothing saved or no session cookie reads as none', () => {
  assert.equal(loadSessionCookies(SITE), null);
  saveSessionCookies(SITE, [RADWARE]);
  assert.equal(loadSessionCookies(SITE), null);
  saveSessionCookies(SITE, [SESSION]);
  assert.equal(loadSessionCookies('https://other.test'), null);
});

test('a session saved under another user, or with no signed-in user, is never restored', () => {
  saveSessionCookies(SITE, [SESSION]);
  signIn(8);
  assert.equal(loadSessionCookies(SITE), null);
  signIn(7);
  assert.ok(loadSessionCookies(SITE));
  fs.rmSync(tokenPath());
  assert.equal(loadSessionCookies(SITE), null);
});

test('a new login deletes the saved session', async () => {
  saveSessionCookies(SITE, [SESSION]);
  const auth = new MoodleToken({
    tokenPath: tokenPath(),
    site: SITE,
    launch: async () => {
      throw new Error('no browser in tests');
    },
  });
  // The window fails to open, after the saved session is already gone.
  await gated(() => auth.connect()).catch(() => {});
  assert.equal(fs.existsSync(FILE), false);
});

test('encrypted at rest with the token key, so no cookie value is on disk', (t) => {
  process.env.FASTSTUDY_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
  t.after(() => delete process.env.FASTSTUDY_TOKEN_KEY);
  saveSessionCookies(SITE, [SESSION]);
  const raw = fs.readFileSync(FILE, 'utf8');
  assert.equal(JSON.parse(raw).v, 1);
  assert.ok(!raw.includes(SESSION.value));
  assert.equal(loadSessionCookies(SITE)[0].value, SESSION.value);
});

test('POST /close keeps the saved session', async () => {
  saveSessionCookies(SITE, [SESSION]);
  await handleClose({}, { status: () => ({ json: () => {} }) });
  assert.ok(loadSessionCookies(SITE));
});

test('disconnect deletes the saved session with the profile', async (t) => {
  await setSite(SITE);
  t.after(() => setSite(null));
  saveSessionCookies(SITE, [SESSION]);
  await setSite('https://other.test');
  assert.equal(authState().storedSite, SITE);
  await siteAuth().auth.disconnect();
  assert.equal(fs.existsSync(FILE), false);
  assert.equal(authState().storedSite, null);
});

test('switching to another site and back keeps the token and the saved session', async (t) => {
  await setSite(SITE);
  t.after(() => setSite(null));
  saveSessionCookies(SITE, [SESSION]);
  const frames = [];
  const onChange = () => frames.push(authState().storedSite);
  authEvents.on('change', onChange);
  t.after(() => authEvents.off('change', onChange));
  await setSite('https://other.test');
  assert.equal(siteAuth().auth.status().connected, false);
  await setSite(null);
  await setSite(SITE);
  assert.equal(siteAuth().auth.status().connected, true);
  // Each switch announces the stored token's site while it differs, idle (no site) included.
  assert.deepEqual(frames, [SITE, SITE, null]);
  assert.ok(loadSessionCookies(SITE));
});

test("a login on another site deletes the stored site's token, session and profile", async (t) => {
  await setSite(SITE);
  t.after(() => setSite(null));
  saveSessionCookies(SITE, [SESSION]);
  fs.mkdirSync(profileDir(), { recursive: true });
  const auth = new MoodleToken({
    tokenPath: tokenPath(),
    site: 'https://other.test',
    launch: async () => {
      throw new Error('no browser in tests');
    },
  });
  await gated(() => auth.connect()).catch(() => {});
  assert.equal(fs.existsSync(tokenPath()), false);
  assert.equal(fs.existsSync(FILE), false);
  assert.equal(fs.existsSync(profileDir()), false);
});

test("a login on the stored token's site keeps the token and the profile", async (t) => {
  fs.mkdirSync(profileDir(), { recursive: true });
  t.after(() => fs.rmSync(profileDir(), { recursive: true, force: true }));
  const auth = new MoodleToken({
    tokenPath: tokenPath(),
    site: SITE,
    launch: async () => {
      throw new Error('no browser in tests');
    },
  });
  await gated(() => auth.connect()).catch(() => {});
  assert.equal(fs.existsSync(tokenPath()), true);
  assert.equal(fs.existsSync(profileDir()), true);
});
