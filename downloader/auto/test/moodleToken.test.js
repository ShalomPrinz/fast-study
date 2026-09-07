// disconnect() is a local-only forget: no server-side revoke, no error when there is no token.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MoodleToken } from '../src/auth/moodleToken.js';

function tokenPathIn(dir) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), dir)), 'auth', 'biu-token.json');
}

test('disconnect deletes a stored token and clears the invalidated flag', async () => {
  const tokenPath = tokenPathIn('moodle-token-');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify({ wstoken: 'abc', privatetoken: null }));
  const auth = new MoodleToken({ tokenPath });
  auth.markExpired();
  assert.deepEqual(auth.status(), { connected: true, expired: true });

  await auth.disconnect();

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(auth.status(), { connected: false, expired: false });
});

test('disconnect with no token stored succeeds', async () => {
  const tokenPath = tokenPathIn('moodle-token-missing-');
  const auth = new MoodleToken({ tokenPath });
  assert.deepEqual(auth.status(), { connected: false, expired: false });

  await auth.disconnect();
  await auth.disconnect(); // idempotent: nothing to delete is not an error

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(auth.status(), { connected: false, expired: false });
});
