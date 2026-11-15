const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { test } = require('node:test');

const {
  FD_ENV,
  adoptHandoff,
  decode,
  deleteSafeStorage,
  encode,
  receive,
} = require('../macHandoff');

const MODULE = path.join(__dirname, '..', 'macHandoff.js');

/** `receive` in a fresh node whose fd 3 is the read end of a real `sh` pipe carrying `text`, mapped
 *  the way the swap helper maps it. Answers what it returned and what it left behind. */
function receiveOver(text, env = { [FD_ENV]: '3' }) {
  const script = `
    const fs = require('node:fs');
    const result = require(${JSON.stringify(MODULE)}).receive(process.env);
    let open = true;
    try { fs.fstatSync(3); } catch { open = false; }
    console.log(JSON.stringify({ result, open, env: process.env.${FD_ENV} ?? null }));
  `;
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/sh',
      [
        '-c',
        'printf \'%s\' "$1" | "$2" -e "$3" 3<&0 </dev/null',
        'sh',
        text,
        process.execPath,
        script,
      ],
      { env: { ...process.env, ...env } },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
    );
  });
}

test('the framing round-trips the secrets and keeps string values only', () => {
  const secrets = { gemini_api_key: 'g"\\\n$`key', groq_api_key: 'q', token_key: 'dA==' };
  assert.deepEqual(decode(encode(secrets)), secrets);
  assert.deepEqual(decode(encode({})), {});
  assert.deepEqual(decode('{"secrets":{"a":"x","b":7,"c":"","d":null}}'), { a: 'x' });
});

test('a cut-off, empty or foreign handoff is refused rather than read as no keys', () => {
  assert.throws(() => decode(''));
  assert.throws(() => decode(encode({ gemini_api_key: 'secret' }).slice(0, -3)));
  assert.throws(() => decode('{}'), /no secrets object/);
  assert.throws(() => decode('{"secrets":[]}'), /no secrets object/);
  assert.throws(() => decode('null'), /no secrets object/);
});

test('receive reads the pipe the helper mapped, closes it and drops the variable', async () => {
  const secrets = { gemini_api_key: 'gemini-secret', token_key: 'dA==' };
  assert.deepEqual(await receiveOver(encode(secrets)), {
    result: { secrets },
    open: false,
    env: null,
  });
});

test('receive answers an error, and still closes the pipe, for a handoff it cannot parse', async () => {
  const { result, open } = await receiveOver('{"secrets":');
  assert.equal(typeof result.error, 'string');
  assert.equal(result.secrets, undefined);
  assert.equal(open, false);
  const big = await receiveOver('x'.repeat(70_000));
  assert.match(big.result.error, /over 65536 bytes/);
  assert.equal(big.open, false);
});

test('a launch with no handoff reads nothing and touches no fd', () => {
  const env = { PATH: '/usr/bin' };
  assert.equal(receive(env), null);
  assert.deepEqual(env, { PATH: '/usr/bin' });
});

test('receive refuses an fd that is not a pipe and leaves it open', async () => {
  assert.match(receive({ [FD_ENV]: 'three' }).error, /is no fd/);
  assert.match(receive({ [FD_ENV]: '0' }).error, /is no fd/);
  // fd 3 here is the pipe; fd 1 is the test's own stdout, named to prove a stranger's fd survives.
  const { result, open } = await receiveOver('ignored', { [FD_ENV]: '9999' });
  assert.match(result.error, /EBADF/);
  assert.equal(open, true);
});

test('the delete loops until no item is left, since security removes one per call', () => {
  const calls = [];
  const statuses = [0, 0, 0, 44];
  const run = (service) => {
    calls.push(service);
    return { status: statuses.shift() };
  };
  assert.deepEqual(deleteSafeStorage('FastStudy Safe Storage', { run }), {
    ok: true,
    line: 'deleted 3 "FastStudy Safe Storage" Keychain item(s)',
  });
  assert.deepEqual(calls, Array(4).fill('FastStudy Safe Storage'));
});

test('the delete reports no item, a failure, a timeout, and stops at its limit', () => {
  const once = (result) => deleteSafeStorage('X Safe Storage', { run: () => result }).line;
  assert.equal(once({ status: 44 }), 'deleted 0 "X Safe Storage" Keychain item(s)');
  assert.equal(
    once({ status: 36, stderr: 'security: SecKeychainItemDelete: denied\n' }),
    'deleted 0 "X Safe Storage" Keychain item(s), then the delete failed: security: SecKeychainItemDelete: denied',
  );
  assert.match(
    once({
      status: null,
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    }),
    /timed out — a Keychain prompt is the likely cause$/,
  );
  assert.match(
    once({ status: null, error: new Error('spawnSync ENOENT') }),
    /failed: spawnSync ENOENT$/,
  );
  let calls = 0;
  const { ok, line } = deleteSafeStorage('X Safe Storage', {
    run: () => (calls++, { status: 0 }),
    limit: 4,
  });
  assert.equal(calls, 4);
  assert.equal(ok, false);
  assert.equal(line, 'deleted 4 "X Safe Storage" Keychain item(s), stopped at the limit');
});

const adoptWith = ({ run, checkAdoptable = () => {}, adopt = () => ['gemini_api_key'] }) => {
  const calls = [];
  const lines = [];
  adoptHandoff({
    handoff: { secrets: { gemini_api_key: 'g' } },
    store: {
      checkAdoptable: () => (calls.push('check'), checkAdoptable()),
      adopt: (plain) => (calls.push('adopt'), adopt(plain)),
    },
    service: 'X Safe Storage',
    log: (line) => lines.push(line),
    run: (...args) => (calls.push('delete'), run(...args)),
  });
  return { calls, lines };
};

test('adopt runs only after every item is gone', () => {
  const statuses = [0, 44];
  const { calls, lines } = adoptWith({ run: () => ({ status: statuses.shift() }) });
  assert.deepEqual(calls, ['check', 'delete', 'delete', 'adopt']);
  assert.deepEqual(lines, [
    'handoff: deleted 1 "X Safe Storage" Keychain item(s)',
    'handoff: re-encrypted gemini_api_key',
  ]);
});

test('a failed or timed-out delete skips adopt', () => {
  const timeout = Object.assign(new Error('x'), { code: 'ETIMEDOUT' });
  for (const result of [
    { status: 36, stderr: 'denied' },
    { status: null, error: timeout },
  ]) {
    const { calls, lines } = adoptWith({ run: () => result });
    assert.deepEqual(calls, ['check', 'delete']);
    assert.match(lines[0], /then the delete failed/);
    assert.match(lines[1], /^handoff not adopted: an old Keychain item may remain/);
  }
});

test('a failed precheck deletes nothing and adopts nothing', () => {
  const { calls, lines } = adoptWith({
    run: () => ({ status: 44 }),
    checkAdoptable: () => {
      throw new Error('the settings file is unreadable');
    },
  });
  assert.deepEqual(calls, ['check']);
  assert.deepEqual(lines, ['handoff not adopted: the settings file is unreadable']);
});
