// The site's Moodle session cookies, kept in the token store (encrypted like the token): they are
// session cookies, gone when the browser relaunches, so a capture restores them instead of an autologin.
import fs from 'node:fs';
import { statePath } from '@faststudy/runtime';
import { readTokenFile, writeTokenFile, tokenPath } from './tokenStore.js';

const file = () => statePath('auth', 'moodle-session.json');

// The stored token's user on `site`, or null: a session saved under another account is never restored.
function owner(site) {
  const token = readTokenFile(tokenPath());
  return token?.site === site && token.userid != null ? token.userid : null;
}

// What context.addCookies needs to put a cookie back; a session cookie has no expiry to keep.
const FIELDS = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite'];

/**
 * Keep `cookies`' session cookies (no expiry) for `site` and the stored token's user; persistent ones
 * already live in the profile.
 */
export function saveSessionCookies(site, cookies) {
  const kept = cookies
    .filter((c) => !(c.expires > 0))
    .map((c) => Object.fromEntries(FIELDS.filter((f) => c[f] !== undefined).map((f) => [f, c[f]])));
  writeTokenFile(file(), { site, userid: owner(site), cookies: kept });
}

/** The cookies kept for `site`, or null when none are (or they belong to another site or user). */
export function loadSessionCookies(site) {
  const record = readTokenFile(file());
  if (record?.site !== site || !Array.isArray(record.cookies)) return null;
  const user = owner(site);
  if (user == null || record.userid !== user) return null;
  return record.cookies.length ? record.cookies : null;
}

export function forgetSessionCookies() {
  fs.rmSync(file(), { force: true });
}
