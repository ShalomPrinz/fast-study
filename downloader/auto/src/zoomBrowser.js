import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { COMMON_LAUNCH_ARGS } from './browserLaunch.js';

// Surgical stealth: apply puppeteer-extra's stealth evasions (window.chrome mocking,
// iframe.contentWindow proxying, stripping CDP-injected props, etc.) to close the
// deeper automation leaks Playwright's plain launch args don't — BUT keep the real
// Chrome UA.
// Before: stealth's 'user-agent-override' evasion rewrites navigator.userAgent, which
//         desyncs from Chrome's Sec-CH-UA Client-Hints -> zoom flags the mismatch.
// After:  that one evasion is deleted, so the genuine UA and Client-Hints stay in sync
//         while every other leak-evasion still runs. (Registered once at module load,
//         and ONLY on playwright-extra's chromium — the plain launcher imports the
//         untouched `chromium` from `playwright`, so non-zoom launches stay stealth-free.)
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
chromium.use(stealth);

// Managed Xvfb virtual display, spawned lazily on the first zoom launch. `null`
// until then. Kept alive across zoom launches; killed on session close / process exit.
let xvfb = null; // { proc: ChildProcess, display: ':N', authFile: string }

const XVFB_READY_TIMEOUT_MS = 10_000;

// Pick a free X display number the way xvfb-run's find_free_servernum does: step up
// from :99 while a server for that number looks taken.
// Before: `-displayfd` lets Xvfb auto-pick, but that path fatally needs to create the
//         filesystem socket /tmp/.X11-unix/X{N} — and here /tmp/.X11-unix is a READ-ONLY
//         tmpfs (WSLg), so the bind fails and no display ever comes up.
// After:  an EXPLICIT `:N` makes Xvfb fall back to a Linux abstract Unix socket (no
//         filesystem entry needed), which works on the ro mount. On this box the FS
//         socket file never appears, so the writable /tmp/.X{N}-lock file is what
//         disambiguates a taken display number.
function findFreeDisplay() {
  for (let n = 99; n < 1000; n++) {
    if (fs.existsSync(`/tmp/.X${n}-lock`)) continue;
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) continue;
    return n;
  }
  throw new Error('no free X display number found (:99-:999 all taken)');
}

// Write a per-run XAUTHORITY holding a MIT-MAGIC-COOKIE for :N (mirrors xvfb-run).
// The same file is handed to both Xvfb (-auth) and Chrome (env XAUTHORITY) so the
// browser can authenticate to the virtual display. Cookie via crypto (no mcookie dep);
// xauth encodes the binary Xauthority format.
function writeXauthority(display) {
  const authFile = path.join(os.tmpdir(), `autodl-xvfb-${process.pid}-${display}.Xauthority`);
  fs.writeFileSync(authFile, ''); // xauth appends to an existing file
  const cookie = randomBytes(16).toString('hex');
  execFileSync('xauth', ['-f', authFile, 'add', `:${display}`, '.', cookie], { stdio: 'ignore' });
  return authFile;
}

/**
 * Spawn Xvfb on an explicit free display and resolve once it accepts connections.
 * `-nolisten tcp` keeps it local-only; the 1280x1024x24 screen is enough for a player.
 * Readiness is polled by connecting to the abstract Unix socket (`\0/tmp/.X11-unix/X{N}`,
 * the one Xvfb actually binds on this ro-tmpfs box) — the `_XSERVTrans…failed to bind
 * listener` lines Xvfb still prints for the (impossible) FILESYSTEM socket are harmless.
 * @returns {Promise<{ proc: import('node:child_process').ChildProcess, display: string, authFile: string }>}
 */
function startXvfb() {
  const num = findFreeDisplay();
  const authFile = writeXauthority(num);
  const proc = spawn(
    'Xvfb',
    [`:${num}`, '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-auth', authFile],
    { stdio: ['ignore', 'ignore', 'pipe'] }, // stderr captured (not inherited) — surfaced only on failure
  );
  let err = '';
  proc.stderr.on('data', (c) => { err += c.toString(); });

  return new Promise((resolve, reject) => {
    let settled = false;
    const deadline = Date.now() + XVFB_READY_TIMEOUT_MS;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    proc.once('error', (e) => finish(reject, new Error(`Failed to spawn Xvfb (${e.message}); is it installed?`)));
    proc.once('exit', (code) => {
      fs.rmSync(authFile, { force: true });
      finish(reject, new Error(`Xvfb exited early (code ${code}).${err ? ` Xvfb said: ${err.trim()}` : ''}`));
    });

    // Poll the abstract socket until the server accepts a connection or we time out.
    const attempt = () => {
      if (settled) return;
      const probe = net.connect(`\0/tmp/.X11-unix/X${num}`);
      probe.once('connect', () => {
        probe.destroy();
        xvfb = { proc, display: `:${num}`, authFile };
        finish(resolve, xvfb);
      });
      probe.once('error', () => {
        probe.destroy();
        if (Date.now() >= deadline) {
          proc.kill('SIGKILL');
          fs.rmSync(authFile, { force: true });
          finish(reject, new Error(`Xvfb :${num} did not accept connections within timeout.${err ? ` Xvfb said: ${err.trim()}` : ''}`));
        } else {
          setTimeout(attempt, 100).unref?.();
        }
      });
    };
    attempt();
  });
}

/** Ensure the managed Xvfb is running; return { display, authFile }. Reuses a live instance. */
async function ensureXvfb() {
  if (xvfb && xvfb.proc.exitCode === null) return xvfb;
  return startXvfb();
}

/** Kill the managed Xvfb and remove its auth file, if any. Safe to call repeatedly. */
export function stopXvfb() {
  if (xvfb) {
    xvfb.proc.kill('SIGTERM');
    fs.rmSync(xvfb.authFile, { force: true });
    xvfb = null;
  }
}

/**
 * Launch the browser the ZOOM recording player needs: system Google Chrome
 * (channel:'chrome'), stealth-cloaked, HEADED on a managed Xvfb virtual display.
 * Before: plain HEADLESS Chrome falls back to SwiftShader software rendering AND leaks
 *         the `HeadlessChrome` UA token -> zoom's player refuses to load the recording.
 * After:  headed system Chrome under Xvfb keeps the real hardware GPU renderer (WSL's
 *         /dev/dxg is reached independent of the X display) AND a clean `Chrome` UA, with
 *         NO visible window (the display is virtual). `--enable-automation` /
 *         AutomationControlled are stripped so navigator.webdriver reports false.
 * Do NOT override the UA (here or via stealth) — it desyncs from Chrome's Client-Hints
 * and zoom flags the mismatch. Do NOT add `--use-angle=vulkan` — no HW Vulkan on this
 * box, so it falls back to SwiftShader.
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchZoomBrowser() {
  const { display, authFile } = await ensureXvfb();
  return chromium.launch({
    headless: false,
    channel: 'chrome',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [...COMMON_LAUNCH_ARGS, '--disable-blink-features=AutomationControlled'],
    // Point Chrome at the virtual display AND its auth cookie so it can connect.
    env: { ...process.env, DISPLAY: display, XAUTHORITY: authFile },
  });
}

// Kill Xvfb on process exit as a safety net (the registry also stops it on /close and
// signal shutdown). Sync-only work is allowed in an 'exit' handler.
process.once('exit', stopXvfb);
