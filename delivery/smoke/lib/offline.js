import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { appExe, workDir } from './paths.js';
import { runToExit } from './windows.js';

// Run by the installed FastStudy.exe as node, so the request leaves through the program the
// outbound rule names. One line out: the status, or the error the connect died on.
const PROBE = `
const target = process.argv[2];
try {
  const response = await fetch(target, { signal: AbortSignal.timeout(20000) });
  console.log('STATUS ' + response.status);
} catch (error) {
  console.log('ERROR ' + (error.cause?.code ?? error.cause?.message ?? error.message));
}
`;

async function fetchAsApp(url) {
  const script = path.join(workDir(), 'probe.mjs');
  fs.mkdirSync(workDir(), { recursive: true });
  fs.writeFileSync(script, PROBE);
  const { output } = await runToExit(appExe(), [script, url], {
    timeoutMs: 60_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  return output.trim();
}

/** Prove the two facts the offline run rests on, each failing under its own name: a program the
 *  rules block still reaches loopback, and it reaches nothing else. */
export async function proveOfflineEnforcement() {
  const server = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const loopback = await fetchAsApp(`http://127.0.0.1:${server.address().port}/`);
    if (!loopback.startsWith('STATUS 200')) {
      throw new Error(
        'assumption failed: Windows Firewall leaves loopback traffic unfiltered under per-program ' +
          `outbound blocks — the blocked FastStudy.exe could not reach 127.0.0.1 (${loopback})`,
      );
    }
  } finally {
    server.close();
  }

  // A neutral host the runner talks to anyway: proving the block never needs a provider request.
  const external = 'https://github.com/';
  const unblocked = await fetch(external).then(
    (response) => `STATUS ${response.status}`,
    (error) => `ERROR ${error.message}`,
  );
  if (!unblocked.startsWith('STATUS')) {
    throw new Error(`the runner itself cannot reach ${external} (${unblocked}), so no block can be proven`);
  }
  const blocked = await fetchAsApp(external);
  if (!blocked.startsWith('ERROR')) {
    throw new Error(
      `the outbound block on FastStudy.exe did not stop a request to ${external} (${blocked}), ` +
        'so the run is not offline and a provider could be reached',
    );
  }
  return { blocked };
}
