import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { SETTINGS, baselineEnv, settingsPatch } from '../lib/baseline.mjs';
import {
  FAKE_KEYS,
  FAKE_MOODLE_SITE,
  SCRATCH_MARKER,
  harnessPaths,
  isScratchData,
  readPorts,
} from '../lib/env.mjs';
import { down, kill, readStack, restart, start, waitForService } from '../lib/stack.mjs';
import { diff } from '../lib/state.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tests-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const freshPaths = (name) => harnessPaths(path.join(scratch, name));

describe('diff', () => {
  test('identical inputs give no lines', () => {
    const state = { a: 1, b: { c: [1, 2], d: null } };
    assert.deepEqual(diff(state, structuredClone(state)), []);
  });

  test('added, removed and changed leaves, by nested path', () => {
    const before = { fakes: { site: { mode: 'ok' } }, gone: true, locks: ['a'] };
    const after = { fakes: { site: { mode: 'blocked' } }, locks: ['a', 'b'], added: 'x' };
    assert.deepEqual(diff(before, after), [
      '~ /fakes/site/mode "ok" → "blocked"',
      '- /gone true',
      '+ /locks/1 "b"',
      '+ /added "x"',
    ]);
  });
});

describe('env', () => {
  test('harnessPaths derives every path from the root and creates nothing', () => {
    const paths = harnessPaths('/h');
    assert.equal(paths.root, '/h');
    assert.equal(paths.data, path.join('/h', 'data'));
    assert.equal(paths.locks, path.join('/h', 'locks.json'));
    assert.equal(paths.network, path.join('/h', 'logs', 'network.log'));
    assert.equal(paths.ports, path.join('/h', 'ports.json'));
    assert.equal(fs.existsSync('/h'), false);
  });

  test('readPorts is {} for a missing or a corrupt file, and the ports for a valid one', () => {
    const paths = freshPaths('ports');
    assert.deepEqual(readPorts(paths), {});
    fs.mkdirSync(paths.root);
    fs.writeFileSync(paths.ports, '{not json');
    assert.deepEqual(readPorts(paths), {});
    fs.writeFileSync(paths.ports, JSON.stringify({ database: 1234 }));
    assert.deepEqual(readPorts(paths), { database: 1234 });
  });

  test('isScratchData needs the marker', () => {
    const dir = path.join(scratch, 'data');
    fs.mkdirSync(dir);
    assert.equal(isScratchData(dir), false);
    fs.writeFileSync(path.join(dir, SCRATCH_MARKER), '');
    assert.equal(isScratchData(dir), true);
  });
});

describe('baseline', () => {
  test('settingsPatch types each field the way the store validates it', () => {
    assert.deepEqual(
      settingsPatch({
        DATA_ROOT: '/d',
        DRIVE_ENABLED: 'YES',
        NIGHTLY_RUN: 'off',
        NIGHTLY_HOUR: '3',
      }),
      { data_root: '/d', drive_enabled: true, nightly_run: false, nightly_hour: 3 },
    );
  });

  test('a bool reads 1/true/yes/on in any case as true, anything else false', () => {
    for (const text of ['1', 'true', 'TRUE', 'Yes', 'on', 'On']) {
      assert.equal(settingsPatch({ DRIVE_ENABLED: text }).drive_enabled, true, text);
    }
    for (const text of ['0', 'false', 'no', 'off', '', 'enabled']) {
      assert.equal(settingsPatch({ DRIVE_ENABLED: text }).drive_enabled, false, text);
    }
  });

  test('an unknown name throws, naming the known ones', () => {
    assert.throws(
      () => settingsPatch({ NOPE: 'x' }),
      new RegExp(`unknown setting NOPE \\(known: ${Object.keys(SETTINGS).join(', ')}\\)`),
    );
  });

  test('baselineEnv names the model only when given one', () => {
    const paths = harnessPaths('/h');
    const bare = baselineEnv(paths);
    assert.equal('GEMINI_MODEL' in bare, false);
    assert.equal(bare.DATA_ROOT, paths.data);
    assert.equal(bare.GROQ_API_KEY, FAKE_KEYS.GROQ_API_KEY);
    assert.equal(bare.MOODLE_SITE, FAKE_MOODLE_SITE);
    assert.equal(baselineEnv(paths, 'gemini-x').GEMINI_MODEL, 'gemini-x');
  });

  test('the baseline is a valid settings patch', () => {
    assert.doesNotThrow(() => settingsPatch(baselineEnv(harnessPaths('/h'), 'm')));
  });
});

describe('start', () => {
  const hold = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer().once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server));
    });
  const close = (server) => new Promise((resolve) => server.close(resolve));
  // A stand-in service: binds what FASTSTUDY_PORT asks, reports the port it got, answers /health.
  const CHILD =
    "const s = require('node:http').createServer((q, r) => r.end('ok'))" +
    ".listen(Number(process.env.FASTSTUDY_PORT), '127.0.0.1'," +
    " () => console.log('FASTSTUDY_PORT=' + s.address().port));";
  const launch = (paths, want, script = CHILD) =>
    start('child', process.execPath, ['-e', script], {
      cwd: scratch,
      env: process.env,
      paths,
      want,
    });
  const recorded = (paths) => readStack(paths).services.child;

  test('takes the port the child reports, and records it in its env and health URL', async (t) => {
    const paths = freshPaths('start-fresh');
    t.after(() => down(paths));
    const { FASTSTUDY_PORT: port } = await launch(paths, {});
    assert.ok(port > 0);
    assert.equal(recorded(paths).env.FASTSTUDY_PORT, String(port));
    assert.equal(recorded(paths).health, `http://127.0.0.1:${port}/health`);
    await waitForService(paths, 'child');
  });

  test('binds the wanted port when it is free', async (t) => {
    const paths = freshPaths('start-reuse');
    t.after(() => down(paths));
    const server = await hold(0);
    const { port: wanted } = server.address();
    await close(server);
    const { FASTSTUDY_PORT: port } = await launch(paths, { FASTSTUDY_PORT: wanted });
    assert.equal(port, wanted);
  });

  test('falls back to any free port when the wanted one is held', async (t) => {
    const paths = freshPaths('start-held');
    t.after(() => down(paths));
    const server = await hold(0);
    t.after(() => close(server));
    const { port: held } = server.address();
    const { FASTSTUDY_PORT: port } = await launch(paths, { FASTSTUDY_PORT: held });
    assert.notEqual(port, held);
    assert.match(
      fs.readFileSync(path.join(paths.logs, 'child.log'), 'utf8'),
      /retrying on any free port/,
    );
  });

  test('a child that exits without reporting fails naming the service', async (t) => {
    const paths = freshPaths('start-silent');
    t.after(() => down(paths));
    await assert.rejects(
      launch(paths, {}, 'process.exit(4)'),
      /^Error: child exited \(code 4\) before reporting its port/,
    );
  });

  test('restart takes the recorded port back, and fails rather than move when it is held', async (t) => {
    const paths = freshPaths('start-restart');
    t.after(() => down(paths));
    const { FASTSTUDY_PORT: port } = await launch(paths, {});
    await restart(paths, 'child', {});
    assert.equal(recorded(paths).env.FASTSTUDY_PORT, String(port));
    await kill(paths, 'child');
    const server = await hold(port);
    t.after(() => close(server));
    await assert.rejects(restart(paths, 'child', {}), /child exited/);
  });
});
