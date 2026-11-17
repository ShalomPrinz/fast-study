// macOS only, best-effort: hides one browser instance by pid as Cmd+H would, and brings it back.
// See docs/ZOOM.md § Hiding the window.
import { execFile } from 'node:child_process';

// JXA over NSRunningApplication: no TCC consent, unlike the System Events route. 2 = NSApplicationActivateIgnoringOtherApps.
const SCRIPT = `ObjC.import('AppKit');
function run(argv) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  if (app.isNil()) throw new Error('no application with pid ' + argv[0]);
  if (argv[1] === 'hide') {
    app.hide;
    return;
  }
  app.unhide;
  app.activateWithOptions(2);
}`;

const TIMEOUT_MS = 15_000;

/** The spawn that hides (`action` 'hide') or unhides and activates ('show') the app with `pid`. */
export function osascriptCommand(pid, action) {
  return {
    file: '/usr/bin/osascript',
    args: ['-l', 'JavaScript', '-e', SCRIPT, String(pid), action],
    options: { timeout: TIMEOUT_MS },
  };
}

function spawnRun(pid, action) {
  const { file, args, options } = osascriptCommand(pid, action);
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, _stdout, stderr) => {
      if (!err) return resolve();
      if (err.killed) return reject(new Error('timed out'));
      reject(new Error(String(stderr).trim() || `exit ${err.code}`));
    });
  });
}

const deps = { run: spawnRun };

/** Tests swap the spawn; → a function restoring the previous one. */
export function configureMacHide(overrides) {
  const prev = { ...deps };
  Object.assign(deps, overrides);
  return () => Object.assign(deps, prev);
}

/** The pid of the browser process behind a Playwright `browser`, which exposes none itself (CDP). */
export async function browserPid(browser) {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const main = processInfo.find((p) => p.type === 'browser');
    if (!main) throw new Error('no browser process reported');
    return main.id;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * `{ hide(), show() }` for one browser instance, `show` unhiding and activating it; never rejects.
 * Changes run one at a time in call order, so a hide asked for mid-show lands after it.
 * @param {import('playwright').Browser} browser
 */
export function macHider(browser) {
  let warned = false;
  const warn = (err) => {
    if (!warned) console.warn(`[window] zoom hide not applied: ${err?.message ?? err}`);
    warned = true;
  };
  const pid = browserPid(browser).catch(warn);
  let tail = pid;

  function request(action) {
    tail = tail.then(async () => {
      const id = await pid;
      if (id === undefined) return;
      try {
        await deps.run(id, action);
      } catch (err) {
        warn(err);
      }
    });
    return tail;
  }

  return { hide: () => request('hide'), show: () => request('show') };
}
