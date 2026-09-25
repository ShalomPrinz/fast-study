// What the harness has to prove before an agent spends a sweep on it. Each check names the
// assumption it is testing, and any failure aborts the run: a silently broken shim turns into
// hours of phantom findings, which is worse than no harness at all.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { AUTO, BACKEND, DATABASE, PROVIDERS, SITE, call, json, waitForFile } from './api.mjs';
import { connectDrive } from './baseline.mjs';
import { APP, APP_SERVICES, openBrowser } from './browser.mjs';
import {
  DEFAULT_DOWNLOAD_MS,
  FAILURE_ROWS,
  FAKE_COURSE_URL,
  FAKE_KEYS,
  FAKE_WSTOKEN,
  PORTS,
  REPO_ROOT,
  SELFCHECK_TAG,
  pythonEnv,
  nodeEnv,
} from './env.mjs';
import { SELFCHECK } from './seed.mjs';

const run = promisify(execFile);

const PY_PROBE = `
import socket
try:
    socket.create_connection(("example.com", 80), 2)
    print("REACHED")
except Exception as error:
    print(type(error).__name__)
`;

const NODE_PROBE = `
const out = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return 'BODY ' + (await response.text()).slice(0, 80);
  } catch (error) {
    return 'ERROR ' + (error.cause?.message ?? error.message);
  }
};
console.log(JSON.stringify({
  offsite: await out('https://example.com/'),
  site: await out('https://lemida.biu.ac.il/health'),
}));
`;

// Names the probe in network.log, so `hb refused` can tell its deliberate escape from a real one.
const probeEnv = (env) => ({ ...env, HUNT_BUGS_SERVICE: SELFCHECK_TAG });

async function pythonEscapeRefused(paths) {
  const { stdout } = await run('python3', ['-c', PY_PROBE], { env: probeEnv(pythonEnv(paths)) });
  if (!stdout.includes('HarnessEscape')) {
    throw new Error(`a Python process reached off loopback (got ${stdout.trim()})`);
  }
  const log = fs.existsSync(paths.network) ? fs.readFileSync(paths.network, 'utf8') : '';
  if (!log.includes(`${SELFCHECK_TAG} REFUSED example.com:80`)) {
    throw new Error('a refused Python connection left no line in network.log');
  }
  return 'python: connect to example.com raised HarnessEscape, logged in network.log';
}

async function nodeEscapeRefusedAndSiteRedirected(paths) {
  const { stdout } = await run('node', ['--input-type=module', '-e', NODE_PROBE], {
    env: probeEnv(nodeEnv(paths)),
  });
  const result = JSON.parse(stdout);
  if (!result.offsite.includes('harness is offline')) {
    throw new Error(`a Node process reached off loopback (got ${result.offsite})`);
  }
  if (!result.site.includes('"status":"ok"')) {
    throw new Error(
      `the fake lecture site did not answer a redirected https request (got ${result.site})`,
    );
  }
  return 'node: example.com refused, lemida.biu.ac.il served by the fake site over TLS';
}

async function noRealKeyInTheServices(paths) {
  for (const service of ['backend', 'database']) {
    const log = fs.readFileSync(path.join(paths.logs, `${service}.log`), 'utf8');
    if (!log.includes('hunt-bugs shim: live')) {
      throw new Error(`${service} started without the shim — its PYTHONPATH did not take`);
    }
    if (!log.includes(FAKE_KEYS.GROQ_API_KEY.slice(0, 12))) {
      throw new Error(`${service} is not running on the harness keys`);
    }
  }
  const { body } = await call(`${DATABASE}/settings`);
  if (body.data_root !== paths.data) {
    throw new Error(
      `the database service reports data_root ${body.data_root}, not the scratch tree`,
    );
  }
  return `keys ${FAKE_KEYS.GROQ_API_KEY.slice(0, 12)}…/${FAKE_KEYS.GEMINI_API_KEY.slice(0, 12)}…, data ${paths.data}`;
}

async function settingsWritesMissTheRealEnv(paths) {
  const realEnv = path.join(REPO_ROOT, '.env');
  const before = fs.statSync(realEnv).mtimeMs; // stat only: the real .env is never read here
  await json(`${DATABASE}/settings`, 'PUT', { gemini_model: 'gemini-2.5-flash' });
  const written = fs.readFileSync(paths.env, 'utf8');
  // The store quotes what it writes, so match the value, not the exact line.
  if (!/GEMINI_MODEL=['"]?gemini-2\.5-flash/.test(written)) {
    throw new Error(`a settings save did not land in ${paths.env}`);
  }
  if (fs.statSync(realEnv).mtimeMs !== before) {
    throw new Error('a settings save rewrote the repo-root .env — stop and fix the shim');
  }
  return `settings writes land in ${paths.env}, repo .env untouched`;
}

async function aPipelineStepRunsGreen() {
  const { course, lecture } = SELFCHECK;
  const base = `${BACKEND}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}`;
  await call(`${base}/run/audio`, { method: 'POST' });
  await waitForFile(course, lecture, 'audio.mp3');
  await call(`${base}/run/transcribe`, { method: 'POST' });
  await waitForFile(course, lecture, 'transcript.txt');
  const { body } = await call(
    `${DATABASE}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/files/transcript.txt`,
  );
  if (!String(body).includes('סיבוכיות')) {
    throw new Error(`the transcript is not the fixture text (got ${String(body).slice(0, 80)})`);
  }
  return 'audio (real ffmpeg) → transcribe (fake Groq) landed the fixture transcript';
}

async function theFakesAnswer() {
  for (const [name, port] of [
    ['providers', PORTS.providers],
    ['site', PORTS.site],
  ]) {
    const { body } = await call(`http://127.0.0.1:${port}/health`);
    if (body.status !== 'ok') throw new Error(`the fake ${name} did not answer /health`);
  }
  return 'fake providers and fake lecture site both answering';
}

// Through auto/'s real listing, so a row the discovery drops fails here, not mid-sweep.
async function theFailureRowsAreListed() {
  const { body } = await json(`${AUTO}/list`, 'POST', { courseUrl: FAKE_COURSE_URL });
  const titles = new Set(body.items.map((item) => item.title));
  const missing = Object.entries(FAILURE_ROWS).filter(([, title]) => !titles.has(title));
  if (missing.length) {
    throw new Error(
      `the fake course listing lacks ${missing.map(([row]) => `/${row}/`).join(', ')}`,
    );
  }
  return `${Object.keys(FAILURE_ROWS)
    .map((row) => `/${row}/`)
    .join(', ')} rows listed among ${titles.size}`;
}

// Each mode is read back through the request it changes, not the /control echo, and switched back.
async function controlModesSwitchAndSwitchBack() {
  const control = (url, body) => json(`${url}/control`, 'POST', body);
  const expect = (what, got, wanted) => {
    if (got !== wanted) throw new Error(`${what}: expected ${wanted}, got ${got}`);
  };
  const groq = async () => {
    const { status, body } = await call(`${PROVIDERS}/groq/openai/v1/audio/transcriptions`, {
      method: 'POST',
      expect: false,
    });
    return status === 200 && !body ? 'empty' : String(status);
  };
  const gemini = async (lecture) => {
    const { status, body } = await call(
      `${PROVIDERS}/gemini/v1beta/models/gemini-2.5-flash:generateContent`,
      {
        method: 'POST',
        expect: false,
        headers: lecture ? { 'x-hunt-bugs-lecture': encodeURI(lecture) } : {},
      },
    );
    if (status === 400) return body.error.details[0].reason;
    return status === 200 && !body.candidates[0].content.parts[0].text ? 'empty' : String(status);
  };
  for (const [provider, read, modes] of [
    ['groq', groq, ['429', '500', 'empty']],
    ['gemini', gemini, ['429', '500', 'empty', 'invalidkey']],
  ]) {
    for (const mode of modes) {
      await control(PROVIDERS, { [provider]: mode });
      expect(`${provider} ${mode}`, await read(), mode === 'invalidkey' ? 'API_KEY_INVALID' : mode);
      await control(PROVIDERS, { [provider]: 'ok' });
      expect(`${provider} back from ${mode}`, await read(), '200');
    }
  }
  await control(PROVIDERS, { gemini: { mode: '500', match: 'hb-x/שיעור 1', times: 1 } });
  expect('targeted, other lecture', await gemini('hb-x/שיעור 10'), '200');
  expect('targeted, no lecture', await gemini(), '200');
  expect('targeted, its lecture', await gemini('hb-x/שיעור 1'), '500');
  expect('targeted, drained', await gemini('hb-x/שיעור 1'), '200');
  await control(PROVIDERS, { reset: true }); // the reads above advanced the fake transcript

  const site = async () => {
    const { body } = await call(
      `${SITE}/webservice/rest/server.php?wsfunction=core_webservice_get_site_info&wstoken=${FAKE_WSTOKEN}`,
    );
    if (typeof body === 'string') return body.includes('Bot check') ? 'blocked' : body;
    return body.errorcode ?? (body.sitename ? 'ok' : JSON.stringify(body));
  };
  for (const mode of ['blocked', 'invalidtoken']) {
    await control(SITE, { mode });
    expect(`site ${mode}`, await site(), mode);
    await control(SITE, { mode: 'ok' });
    expect(`site back from ${mode}`, await site(), 'ok');
  }
  const toolMs = async () => (await call(`${SITE}/tool?url=selfcheck`)).body.downloadMs;
  await control(SITE, { downloadMs: 1234 });
  expect('site downloadMs', await toolMs(), 1234);
  await control(SITE, { downloadMs: DEFAULT_DOWNLOAD_MS });
  expect('site downloadMs back', await toolMs(), DEFAULT_DOWNLOAD_MS);
  return 'groq 429|500|empty, gemini 429|500|empty|invalidkey, a targeted next-1, site blocked|invalidtoken|downloadMs — each on and back off';
}

// Through the backend's routes and the shim's fake consent, ending connected as the baseline has it.
async function driveDisconnectsAndReconnects() {
  const connected = async () => (await call(`${BACKEND}/config/drive/status`)).body.connected;
  if (!(await connected())) throw new Error('Drive is not connected after the seed');
  await call(`${BACKEND}/config/drive/disconnect`, { method: 'POST' });
  if (await connected()) throw new Error('Drive still reads connected after a disconnect');
  await connectDrive();
  return 'connected → disconnected → connected';
}

// The frontend-to-service path, from the app's own origin: a CORS allowlist that does not name it
// fails here rather than on a flow's first click. The page is screenshotted either way.
async function theAppLoadsFromItsOrigin(paths) {
  const { body: tree } = await call(`${DATABASE}/tree`);
  const courses = tree.filter((course) => !course.archived).map((course) => course.name);
  const { browser, page } = await openBrowser();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  try {
    await page.goto(APP);
    const reached = await page.evaluate(
      (services) =>
        Promise.all(
          Object.entries(services).map(([name, url]) =>
            fetch(`${url}/health`).then(
              (response) => `${name} ${response.status}`,
              (error) => `${name} blocked (${error.message})`,
            ),
          ),
        ),
      APP_SERVICES,
    );
    const blocked = reached.filter((line) => !line.endsWith(' 200'));
    if (blocked.length) {
      throw new Error(`from ${APP}: ${blocked.join(', ')}\n${errors.slice(0, 4).join('\n')}`);
    }
    for (const name of courses) {
      await page
        .getByText(name, { exact: true })
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {
          throw new Error(`${APP} never listed course "${name}"\n${errors.slice(0, 4).join('\n')}`);
        });
    }
    return `${APP} lists all ${courses.length} courses; ${reached.join(', ')}`;
  } finally {
    await page.screenshot({ path: path.join(paths.evidence, 'selfcheck-app.png') }).catch(() => {});
    await browser.close();
  }
}

const CHECKS = [
  ['fakes up', theFakesAnswer],
  ['fake modes switch and switch back', controlModesSwitchAndSwitchBack],
  ['failure rows listed', theFailureRowsAreListed],
  ['escape alarm (python)', pythonEscapeRefused],
  ['escape alarm + site redirect (node)', nodeEscapeRefusedAndSiteRedirected],
  ['no real key in any service', noRealKeyInTheServices],
  ['settings writes miss the real .env', settingsWritesMissTheRealEnv],
  ['drive disconnects and reconnects', driveDisconnectsAndReconnects],
  ['the app loads and reaches every service', theAppLoadsFromItsOrigin],
  ['a pipeline step runs green', aPipelineStepRunsGreen],
];

/** Run every check in order, printing one line each. Throws on the first failure. */
export async function selfCheck(paths, { skipPipeline = false } = {}) {
  for (const [name, check] of CHECKS) {
    if (skipPipeline && name === 'a pipeline step runs green') {
      console.log(`  – ${name}: skipped (--skip-pipeline-check)`);
      continue;
    }
    const detail = await check(paths);
    console.log(`  ✓ ${name}: ${detail}`);
  }
}
