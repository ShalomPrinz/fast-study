// The headless browser the session driver and the self-check both launch. Playwright comes from
// downloader/auto/, the one service that already installs it, so the harness adds no dependency.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PORTS, REPO_ROOT } from './env.mjs';

const { chromium } = createRequire(path.join(REPO_ROOT, 'downloader', 'auto', 'package.json'))(
  'playwright',
);

// localhost, never 127.0.0.1: every service's CORS allowlist names this origin and no other.
export const APP = `http://localhost:${PORTS.frontend}`;

// Where the frontend reaches each service in a dev run (frontend/src/services/runtime.ts).
export const APP_SERVICES = {
  database: `http://localhost:${PORTS.database}`,
  backend: `http://localhost:${PORTS.backend}`,
  'downloader-server': `http://localhost:${PORTS.server}`,
  'downloader-auto': `http://localhost:${PORTS.auto}`,
};

// The newest installed build, not the pinned one: the cache often lags the Playwright version.
// Headless shell first, the full chromium as a fallback — both run headless.
function installedChromium() {
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

/** Launch headless chromium and open one page, 1400×900, with a 10 s action timeout. */
export async function openBrowser() {
  const browser = await chromium.launch({
    executablePath: installedChromium(),
    // The browser is outside both shims, so it is offlined here: any name but loopback fails.
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();
  return { browser, context, page };
}
