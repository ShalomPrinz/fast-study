import fs from 'node:fs';
import path from 'node:path';
import { readLaunchLog } from './app.js';
import { resultsDir } from './paths.js';
import { delay } from './wait.js';

// What the suite times, and only numbers and identifiers: the file is a public Release asset, so no
// launch.log text, path or port ever goes in. Recording never fails the suite.
const SERVICES = ['database', 'auto', 'backend', 'server'];
const LOG_WAIT_MS = 10_000;
const boots = {};

export const bootTimingFile = () => path.join(resultsDir(), 'boot-timing.json');

/** Epoch ms of a `launch.log` stamp, read as local time — main writes it in this machine's zone. */
function stampMs(line) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) /.exec(line);
  return m ? new Date(m[1], m[2] - 1, m[3], m[4], m[5], m[6], m[7]).getTime() : null;
}

/** Main's first line as t0, each service's `ready on` line as ms after it, and the epoch ms of main's
 *  `app loaded` line — the launcher's own mark of app://bundle finishing its load; null where absent. */
export function parseBoot(log) {
  const lines = log.split('\n');
  const t0 = stampMs(lines[0] ?? '');
  const ready = {};
  let appLoaded = null;
  for (const line of lines) {
    const m = /\[main\] (\w+) ready on http:/.exec(line);
    const at = m && stampMs(line);
    if (t0 !== null && at !== null && SERVICES.includes(m[1]) && !(m[1] in ready))
      ready[m[1]] = at - t0;
    if (appLoaded === null && line.includes('[main] app loaded app://bundle/'))
      appLoaded = stampMs(line);
  }
  return { t0, ready, appLoaded };
}

/** One launch's timings: Playwright's launch → main's `app loaded` line (same machine, same clock),
 *  main's first log line → that line, and each service's ready offset from t0. */
export function bootEntry(session, log) {
  const { t0, ready, appLoaded } = parseBoot(log);
  const span = (from, to) => (from != null && to != null ? to - from : null);
  return {
    launch_to_app_ms: span(session.launchedAt, appLoaded),
    log_to_app_ms: span(t0, appLoaded),
    ready_ms: Object.fromEntries(SERVICES.map((name) => [name, ready[name] ?? null])),
  };
}

/** Record `session`'s boot as `name` and rewrite the file, so a later failure keeps what came before.
 *  Waits briefly for the four ready lines and `app loaded`, since the log is a stream; a missing one is null. */
export async function recordBoot(name, session, version) {
  try {
    let log = readLaunchLog();
    for (let waited = 0; waited < LOG_WAIT_MS; waited += 500) {
      const { ready, appLoaded } = parseBoot(log);
      if (Object.keys(ready).length === SERVICES.length && appLoaded !== null) break;
      await delay(500);
      log = readLaunchLog();
    }
    const entry = bootEntry(session, log);
    if (
      entry.launch_to_app_ms === null ||
      entry.log_to_app_ms === null ||
      Object.values(entry.ready_ms).includes(null)
    )
      console.warn(`boot timing "${name}" is incomplete: ${JSON.stringify(entry)}`);
    boots[name] = entry;
    const run = (name) => (process.env[name] ? Number(process.env[name]) : null);
    const out = {
      schema: 1,
      version,
      commit: process.env.GITHUB_SHA ?? null,
      run_id: run('GITHUB_RUN_ID'),
      run_attempt: run('GITHUB_RUN_ATTEMPT'),
      boots,
    };
    fs.mkdirSync(resultsDir(), { recursive: true });
    fs.writeFileSync(bootTimingFile(), `${JSON.stringify(out, null, 2)}\n`);
  } catch (error) {
    console.warn(`boot timing "${name}" not recorded: ${error.message}`);
  }
}
