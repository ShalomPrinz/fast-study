import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { readLaunchLog, readyPorts } from '../../lib/app.js';
import { evidence } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';
import { services } from '../../lib/session.js';
import { waitFor } from '../../lib/wait.js';

const MANIFEST = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.faststudy.bridge.json',
);

/** Send `host` one framed `{}` as Chrome does — the origin as its argument, stdin left open — and
 *  answer its framed reply. */
function ask(host, origin) {
  return new Promise((resolve, reject) => {
    const child = spawn(host, [origin], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = Buffer.alloc(0);
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${host} did not answer within 20s; stderr: ${err}`));
    }, 20_000);
    child.stdout.on('data', (chunk) => (out = Buffer.concat([out, chunk])));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (out.length < 4 || out.length < 4 + out.readUInt32LE(0)) {
        reject(new Error(`${host} exited ${code} with ${out.length} bytes; stderr: ${err}`));
        return;
      }
      resolve(JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8')));
    });
    const body = Buffer.from('{}');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

export default async function nativeHost() {
  await waitFor(() => fs.existsSync(MANIFEST), {
    timeoutMs: 30_000,
    message: `the running app wrote no ${MANIFEST}`,
  });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const script = fs.readFileSync(manifest.path, 'utf8');
  const reply = await ask(manifest.path, manifest.allowed_origins[0]);

  const server = readyPorts(readLaunchLog()).find((ready) => ready.service === 'server');
  const shipped = JSON.parse(
    fs.readFileSync(path.join(paths.resourcesDir(), 'extension', 'manifest.json'), 'utf8'),
  );
  // The launch secret is compared, never printed.
  const printable = {
    ...reply,
    secret: reply.secret === services.secret ? '<the launch secret>' : '<NOT the launch secret>',
  };
  evidence(
    '5. native host',
    [
      `${MANIFEST}:`,
      JSON.stringify(manifest, null, 2),
      `${manifest.path}:`,
      script.trim(),
      `reply: ${JSON.stringify(printable)}`,
      `server is ready on port ${server?.port}; the shipped extension is ${shipped.version}`,
    ].join('\n'),
  );
  expect(reply.port, 'the host answered another port than server listens on').toBe(server?.port);
  expect(reply.secret === services.secret, 'the host answered another secret').toBe(true);
  expect(reply.extensionVersion).toBe(shipped.version);
}
