import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';
import { appExe, launchLog, resultsDir } from './paths.js';

const BOOT_TIMEOUT_MS = 180_000;
let launches = 0;

const ASSUMPTION_ELECTRON =
  "assumption unproven: Playwright's _electron drives the packaged exe on a windows-latest runner, window and all";

/** Launch the installed app the way a user's shortcut does, plus `--lang=en-US` so a failure
 *  screenshot is readable, with `env` over the runner's. Answers `{ app, page, n }`; the trace records until `quit`. */
export async function launch(env = {}) {
  const n = ++launches;
  let app;
  try {
    app = await electron.launch({
      executablePath: appExe(),
      args: ['--lang=en-US'],
      // Playwright's `env` replaces the environment rather than extending it.
      env: { ...process.env, ...env },
      timeout: 120_000,
    });
  } catch (error) {
    throw new Error(`could not launch ${appExe()} (${ASSUMPTION_ELECTRON}): ${error.message}`);
  }
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  let page;
  try {
    page = await app.firstWindow({ timeout: 60_000 });
  } catch (error) {
    throw new Error(
      `the app opened no window Playwright could see (${ASSUMPTION_ELECTRON}): ${error.message}`,
    );
  }
  return { app, page, n };
}

/** Wait for the launch screen to hand over to `app://bundle`. A boot that fails stays on the launch
 *  screen, so its error and failed row are what the failure reports. */
export async function waitForApp(session) {
  const { page } = session;
  const failed = page.getByTestId('boot-error');
  const navigated = page
    .waitForURL((url) => url.protocol === 'app:' && url.host === 'bundle', {
      timeout: BOOT_TIMEOUT_MS,
    })
    .then(() => 'app');
  const stuck = failed.waitFor({ state: 'visible', timeout: BOOT_TIMEOUT_MS }).then(() => 'failed');
  // The loser keeps waiting until its own timeout; swallowing it keeps that from surfacing later.
  navigated.catch(() => {});
  stuck.catch(() => {});
  const outcome = await Promise.race([navigated, stuck]);
  if (outcome === 'failed') {
    const rows = page.locator('[data-testid="boot-row"][data-state="failed"]');
    const service = (await rows.count()) ? await rows.first().getAttribute('data-service') : '?';
    throw new Error(`boot failed on ${service}: ${await failed.textContent()} — see launch.log`);
  }
}

/** The bridge's service URLs and launch secret — how the suite reaches the services as the app does. */
export async function bridge(page) {
  return page.evaluate(() => ({ urls: window.faststudy.urls, secret: window.faststudy.secret }));
}

/** Close the window the way a user does and wait for the whole app to exit. Saves the trace and a
 *  copy of this launch's `launch.log`, which the next launch truncates. */
export async function quit(session) {
  const { app, n } = session;
  const exited = new Promise((resolve) => {
    if (app.process().exitCode !== null) resolve();
    else app.process().once('exit', resolve);
  });
  await app
    .context()
    .tracing.stop({ path: path.join(resultsDir(), 'traces', `launch-${n}.zip`) })
    .catch(() => {});
  // The window's own close, which is what the title-bar X runs: `window-all-closed` then quits.
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()))
    .catch(() => {});
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error('the app did not exit within 60s of its window closing')),
      60_000,
    ),
  );
  try {
    await Promise.race([exited, timeout]);
  } finally {
    saveLaunchLog(n);
    await app.close().catch(() => {});
  }
}

/** Kill a session that a failed check left running, keeping its trace and log. */
export async function abandon(session) {
  if (!session) return;
  await session.app
    .context()
    .tracing.stop({ path: path.join(resultsDir(), 'traces', `launch-${session.n}.zip`) })
    .catch(() => {});
  saveLaunchLog(session.n);
  await session.app.close().catch(() => {});
}

export function saveLaunchLog(n) {
  const target = path.join(resultsDir(), 'launch-logs', `launch-${n}.log`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.copyFileSync(launchLog(), target);
  } catch {
    // No log yet means the launch never got as far as main's first line; the trace says why.
  }
}

export function readLaunchLog() {
  try {
    return fs.readFileSync(launchLog(), 'utf8');
  } catch {
    return '';
  }
}

/** The ports main recorded for each child — `<name> ready on http://127.0.0.1:<port>`. */
export function readyPorts(log) {
  return [...log.matchAll(/\[main\] (\w+) ready on http:\/\/127\.0\.0\.1:(\d+)/g)].map((m) => ({
    service: m[1],
    port: Number(m[2]),
  }));
}
