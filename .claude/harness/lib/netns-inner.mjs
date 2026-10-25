// Runs inside the browser's network namespace: brings lo up, relays each stack port to the Unix
// sockets the launcher listens on, then runs the real chromium with Playwright's pipe fds (3, 4).
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { tcpToUnix } from './relay.mjs';

const { HB_NETNS_CHROMIUM: chromium, HB_NETNS_DIR: dir, HB_NETNS_PORTS: ports } = process.env;
execFileSync('ip', ['link', 'set', 'lo', 'up']);
await Promise.all(
  ports
    .split(',')
    .filter(Boolean)
    .map((port) => tcpToUnix(Number(port), path.join(dir, `${port}.sock`))),
);

const child = spawn(chromium, process.argv.slice(2), {
  stdio: ['inherit', 'inherit', 'inherit', 3, 4],
});
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
