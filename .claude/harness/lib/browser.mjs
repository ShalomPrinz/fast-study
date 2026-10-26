// The headless browser the session driver and the self-check both launch. Playwright comes from
// downloader/auto/, the one service that already installs it, so the harness adds no dependency.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PORTS, REPO_ROOT } from './env.mjs';
import { probe, wrapperScript } from './netns.mjs';
import { unixToTcp } from './relay.mjs';

const { chromium } = createRequire(path.join(REPO_ROOT, 'downloader', 'auto', 'package.json'))(
  'playwright',
);

// localhost, never 127.0.0.1: a dev service's CORS allowlist takes any localhost port and no other host.
export const appUrl = () => `http://localhost:${PORTS.frontend}`;

// Where the frontend reaches each service, handed to vite as VITE_*_URL (frontend/src/services/runtime.ts).
export const appServices = () => ({
  database: `http://localhost:${PORTS.database}`,
  backend: `http://localhost:${PORTS.backend}`,
  'downloader-server': `http://localhost:${PORTS.server}`,
  'downloader-auto': `http://localhost:${PORTS.auto}`,
});

// The newest installed build, not the pinned one: the cache often lags the Playwright version.
// Headless shell first, the full chromium as a fallback — both run headless.
export function installedChromium() {
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  const entries = fs.existsSync(cache) ? fs.readdirSync(cache) : [];
  for (const [prefix, binary] of [
    ['chromium_headless_shell-', 'chrome-headless-shell-linux64/chrome-headless-shell'],
    ['chromium-', 'chrome-linux64/chrome'],
  ]) {
    const found = entries
      .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
      .map((name) => path.join(cache, name, binary))
      .find((file) => fs.existsSync(file));
    if (found) return found;
  }
  throw new Error(
    `no chromium under ${cache} — install one with \`npx playwright install chromium\``,
  );
}

// The browser is outside both shims, so it is offlined here: any name but loopback fails.
export const OFFLINE_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
];

// The ports a page reaches: the four services and the frontend. Fakes are reached by services, never by the page.
const PAGE_PORTS = ['database', 'backend', 'server', 'auto', 'frontend'];

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
let probed;
let noticed = false;

/** Launch chromium in a private network namespace (no `ERR_NETWORK_CHANGED`), else in the host with one notice. */
export async function launchChromium(launcher = chromium, options = {}) {
  const base = { ...options, executablePath: installedChromium(), args: OFFLINE_ARGS };
  probed ??= probe();
  const reason = await probed;
  if (reason) {
    if (!noticed) console.log(`# harness: browser not network-isolated (${reason})`);
    noticed = true;
    return launcher.launch(base);
  }
  // A short temp dir, not the harness root: a socket path is capped near 100 characters.
  for (const old of fs.readdirSync(os.tmpdir())) {
    const pid = /^hbns-(\d+)-/.exec(old)?.[1];
    if (pid && !alive(Number(pid)))
      fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hbns-${process.pid}-`));
  const ports = PAGE_PORTS.map((name) => PORTS[name]).filter(Boolean);
  const relays = [];
  let browser;
  const cleanup = () => {
    for (const relay of relays) relay.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  process.once('exit', cleanup);
  try {
    for (const port of ports) relays.push(await unixToTcp(path.join(dir, `${port}.sock`), port));
    const wrapper = path.join(dir, 'chromium');
    fs.writeFileSync(wrapper, wrapperScript(), { mode: 0o755 });
    browser = await launcher.launch({
      ...base,
      executablePath: wrapper,
      env: {
        ...process.env,
        HB_NETNS_CHROMIUM: base.executablePath,
        HB_NETNS_DIR: dir,
        HB_NETNS_PORTS: ports.join(','),
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }
  browser.on('disconnected', () => {
    process.off('exit', cleanup);
    cleanup();
  });
  return browser;
}

/** Launch headless chromium and open one page, 1400×900, with a 10 s action timeout. */
export async function openBrowser() {
  const browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();
  return { browser, context, page };
}
