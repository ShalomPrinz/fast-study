// Run by the installed app binary as node: opens the staged `auto`'s real zoom session beside a
// separately launched browser, and reports each one's NSRunningApplication.hidden as JSON lines.
// argv: <staged downloader/auto> <scratch dir>
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [auto, scratch] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(path.join(auto, 'src', 'browser', file)).href);

const STATE = `ObjC.import('AppKit');
function run(argv) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  if (app.isNil()) return 'gone';
  return JSON.stringify({ hidden: Boolean(app.hidden), active: Boolean(app.active) });
}`;

function stateOf(pid) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', STATE, String(pid)],
      { timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`osascript: ${String(stderr).trim() || error.message}`));
        else resolve(stdout.trim() === 'gone' ? null : JSON.parse(stdout));
      },
    );
  });
}

const say = (step, detail) => console.log(JSON.stringify({ step, ...detail }));

/** Poll `pid` until `want(state)` holds, answering that state; throws naming the last one seen. */
async function until(pid, what, want) {
  let last;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
    last = await stateOf(pid);
    if (want(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`pid ${pid} never became ${what}; last state ${JSON.stringify(last)}`);
}

// The "user's own" browser: a second instance on its own profile, launched as its own process.
const USER_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

let user = null;
let closeAllSessions = async () => {};
let failed = false;
try {
  const binary = USER_BROWSERS.find((file) => fs.existsSync(file));
  if (!binary) throw new Error(`neither ${USER_BROWSERS.join(' nor ')} exists`);
  user = spawn(
    binary,
    [
      `--user-data-dir=${path.join(scratch, 'user-browser-profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  say('user browser launched', {
    pid: user.pid,
    binary,
    ...(await until(user.pid, 'a running app', Boolean)),
  });

  const sessions = await load('browserSession.js');
  const { browserPid, macHider } = await load('macHide.js');
  closeAllSessions = sessions.closeAllSessions;
  const zoom = sessions.getSession('zoom');
  await zoom.open();
  const pid = await browserPid(zoom.browser);
  say('zoom browser opened', { pid, platform: process.platform });

  // The launch's hide is not awaited, so the hidden state is polled for.
  say(
    'zoom browser after its launch',
    await until(pid, 'hidden', (state) => state?.hidden === true),
  );
  const beside = await stateOf(user.pid);
  say('user browser beside the hidden zoom browser', beside ?? { gone: true });
  if (beside?.hidden !== false) throw new Error('the user browser is hidden or gone');

  await macHider(zoom.browser).show();
  say(
    'zoom browser after show()',
    await until(pid, 'unhidden', (state) => state?.hidden === false),
  );
} catch (error) {
  failed = true;
  say('FAILED', { error: error.stack ?? String(error) });
} finally {
  await closeAllSessions().catch(() => {});
  user?.kill('SIGKILL');
}
// An explicit exit: a leftover handle in the staged code must not hold the probe open.
process.exit(failed ? 1 : 0);
