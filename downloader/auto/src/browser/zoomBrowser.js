import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { COMMON_LAUNCH_ARGS } from './browserLaunch.js';
import { resolveBrowserChannel } from './browserChannel.js';

// Stealth minus its 'user-agent-override' evasion (a rewritten UA desyncs from Client-Hints),
// registered ONLY on playwright-extra's chromium so plain launches stay clean. See docs/ZOOM.md.
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
chromium.use(stealth);

// Managed Xvfb virtual display, Linux only (Windows parks the window off-screen, so this stays
// null there). Spawned lazily on the first zoom launch; killed on session close / process exit.
let xvfb = null; // { proc: ChildProcess, display: ':N', authFile: string }

const XVFB_READY_TIMEOUT_MS = 10_000;

// Pick a free display EXPLICITLY (up from :99), never via `-displayfd`: WSLg's read-only
// /tmp/.X11-unix needs the abstract socket only an explicit `:N` falls back to. See docs/ZOOM.md.
function findFreeDisplay() {
  for (let n = 99; n < 1000; n++) {
    if (fs.existsSync(`/tmp/.X${n}-lock`)) continue;
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) continue;
    return n;
  }
  throw new Error('no free X display number found (:99-:999 all taken)');
}

// Per-run XAUTHORITY (MIT-MAGIC-COOKIE for :N), handed to both Xvfb (-auth) and the browser
// (env XAUTHORITY) so it can authenticate to the virtual display.
function writeXauthority(display) {
  const authFile = path.join(os.tmpdir(), `autodl-xvfb-${process.pid}-${display}.Xauthority`);
  fs.writeFileSync(authFile, ''); // xauth appends to an existing file
  const cookie = randomBytes(16).toString('hex');
  execFileSync('xauth', ['-f', authFile, 'add', `:${display}`, '.', cookie], { stdio: 'ignore' });
  return authFile;
}

/**
 * Spawn Xvfb on an explicit free display; resolve once it accepts connections, polled on
 * the abstract Unix socket it binds on this ro-tmpfs box (the `failed to bind listener`
 * lines it prints for the impossible FS socket are harmless). See docs/ZOOM.md.
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
  proc.stderr.on('data', (c) => {
    err += c.toString();
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const deadline = Date.now() + XVFB_READY_TIMEOUT_MS;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    proc.once('error', (e) =>
      finish(reject, new Error(`Failed to spawn Xvfb (${e.message}); is it installed?`)),
    );
    proc.once('exit', (code) => {
      fs.rmSync(authFile, { force: true });
      finish(
        reject,
        new Error(`Xvfb exited early (code ${code}).${err ? ` Xvfb said: ${err.trim()}` : ''}`),
      );
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
          finish(
            reject,
            new Error(
              `Xvfb :${num} did not accept connections within timeout.${err ? ` Xvfb said: ${err.trim()}` : ''}`,
            ),
          );
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

/** Kill the managed Xvfb and remove its auth file, if any. No-op on Windows; safe to repeat. */
export function stopXvfb() {
  if (xvfb) {
    xvfb.proc.kill('SIGTERM');
    fs.rmSync(xvfb.authFile, { force: true });
    xvfb = null;
  }
}

/**
 * Launch the browser the zoom player needs: the user's Chrome or Edge, stealth-cloaked, HEADED
 * but hidden per platform, with no bundled fallback. Hard constraints in docs/ZOOM.md.
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchZoomBrowser() {
  const windows = process.platform === 'win32';
  const args = [...COMMON_LAUNCH_ARGS, '--disable-blink-features=AutomationControlled'];
  // Windows has no Xvfb, so the window is parked off-screen instead — otherwise a batch of N
  // lectures steals focus N times. FASTSTUDY_ZOOM_VISIBLE=1 keeps it on-screen to watch a capture.
  if (windows && process.env.FASTSTUDY_ZOOM_VISIBLE !== '1') {
    args.push('--window-position=-32000,-32000');
  }

  const { channel } = await resolveBrowserChannel();
  const opts = {
    headless: false,
    channel,
    ignoreDefaultArgs: ['--enable-automation'],
    args,
  };
  if (windows) return chromium.launch(opts);

  const { display, authFile } = await ensureXvfb();
  // Point the browser at the virtual display AND its auth cookie so it can connect.
  return chromium.launch({
    ...opts,
    env: { ...process.env, DISPLAY: display, XAUTHORITY: authFile },
  });
}

// Kill Xvfb on process exit as a safety net (the registry also stops it on /close and signal
// shutdown; a no-op on Windows). Sync-only work is allowed in an 'exit' handler.
process.once('exit', stopXvfb);
