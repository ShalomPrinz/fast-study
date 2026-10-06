import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { actionRequest } from '../lib/act.mjs';

const HB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hb.mjs');
const noStdin = () => assert.fail('stdin read');

describe('actionRequest', () => {
  test('positionals map onto the fields, flags anywhere', () => {
    const request = actionRequest('fill', ['--browser', 'b', 'input', '--shot', 's', 'v'], noStdin);
    assert.deepEqual(request, {
      tag: 'b',
      path: '/fill',
      body: JSON.stringify({ selector: 'input', value: 'v', screenshot: 's' }),
    });
  });

  test('press without a selector sends only the key, to the main session', () => {
    assert.deepEqual(actionRequest('press', ['Enter'], noStdin), {
      tag: 'main',
      path: '/press',
      body: '{"key":"Enter"}',
    });
  });

  test('an empty fill value is a value, not a missing one', () => {
    assert.equal(JSON.parse(actionRequest('fill', ['input', ''], noStdin).body).value, '');
  });

  test('values that look like flags pass after --, and other dashes pass as typed', () => {
    const body = JSON.parse(actionRequest('fill', ['-x', '--', '--shot'], noStdin).body);
    assert.deepEqual(body, { selector: '-x', value: '--shot' });
  });

  test('eval takes its JS from the argument, or stdin when none or -', () => {
    assert.equal(actionRequest('eval', ['return 1'], noStdin).body, 'return 1');
    assert.equal(actionRequest('eval', [], () => 'from stdin').body, 'from stdin');
    assert.equal(actionRequest('eval', ['-'], () => 'dash').body, 'dash');
  });

  for (const [name, args] of [
    ['click', []],
    ['fill', ['only-selector']],
    ['click', ['a', 'b']],
    ['goto', ['/', '--shot', 'x']],
    ['eval', ['x', '--shot', 'y']],
    ['click', ['a', '--shot']],
  ]) {
    test(`${name} ${JSON.stringify(args)} is a usage error`, () => {
      assert.throws(() => actionRequest(name, args, noStdin), /usage:|needs a value/);
    });
  }
});

// End to end through hb's real argv (no shell), against a stand-in session that records the body.
describe('hb actions against a session', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-actions-'));
  const received = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    received.push({ path: request.url, raw });
    response.writeHead(raw.includes('FAIL') ? 500 : 200).end(`ok ${request.url}\n`);
  });

  before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    fs.writeFileSync(path.join(root, 'ports.json'), JSON.stringify({ 'browser-main': port }));
  });
  after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function hb(args, stdin = '') {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [HB, '--harness', root, ...args]);
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
      child.on('close', (code) => resolve({ code, out }));
      child.stdin.end(stdin);
    });
  }

  test('the session receives exactly the strings typed', async () => {
    const selector = `text="it's \\"quoted\\" \\\\ $HOME \`x\` !"`;
    const value = 'שלום עולם — ünï 🎓\nsecond line\t$PATH';
    const { code } = await hb(['fill', selector, value]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(received.at(-1).raw), { selector, value });
  });

  test('a value reading --harness stays a value', async () => {
    await hb(['fill', 'input', '--harness']);
    assert.deepEqual(JSON.parse(received.at(-1).raw), { selector: 'input', value: '--harness' });
  });

  test('eval sends stdin as the raw body', async () => {
    const js = 'const a = "{\\"js\\": 1}";\nreturn a;';
    await hb(['eval'], js);
    assert.deepEqual(received.at(-1), { path: '/eval', raw: js });
  });

  test('a failed action prints the answer and exits 1', async () => {
    const { code, out } = await hb(['click', 'FAIL']);
    assert.equal(code, 1);
    assert.equal(out, 'ok /click\n');
  });

  test('an unknown session names how to start it', async () => {
    const { code, out } = await hb(['click', 'a', '--browser', 'nope']);
    assert.equal(code, 1);
    assert.match(out, /no browser session "nope"/);
  });
});
