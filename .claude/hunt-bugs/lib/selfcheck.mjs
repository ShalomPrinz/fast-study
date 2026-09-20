// What the harness has to prove before an agent spends a sweep on it. Each check names the
// assumption it is testing, and any failure aborts the run: a silently broken shim turns into
// hours of phantom findings, which is worse than no harness at all.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { BACKEND, DATABASE, call, json, waitForFile } from './api.mjs';
import { FAKE_KEYS, PORTS, REPO_ROOT, pythonEnv, nodeEnv } from './env.mjs';
import { COURSES } from './seed.mjs';

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

async function pythonEscapeRefused(paths) {
  const { stdout } = await run('python3', ['-c', PY_PROBE], { env: pythonEnv(paths) });
  if (!stdout.includes('HarnessEscape')) {
    throw new Error(`a Python process reached off loopback (got ${stdout.trim()})`);
  }
  return 'python: connect to example.com raised HarnessEscape';
}

async function nodeEscapeRefusedAndSiteRedirected(paths) {
  const { stdout } = await run('node', ['--input-type=module', '-e', NODE_PROBE], { env: nodeEnv(paths) });
  const result = JSON.parse(stdout);
  if (!result.offsite.includes('harness is offline')) {
    throw new Error(`a Node process reached off loopback (got ${result.offsite})`);
  }
  if (!result.site.includes('"status":"ok"')) {
    throw new Error(`the fake lecture site did not answer a redirected https request (got ${result.site})`);
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
    throw new Error(`the database service reports data_root ${body.data_root}, not the scratch tree`);
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
  const lecture = 'שיעור 1';
  const base = `${BACKEND}/courses/${encodeURIComponent(COURSES.hebrew)}/lectures/${encodeURIComponent(lecture)}`;
  await call(`${base}/run/audio`, { method: 'POST' });
  await waitForFile(COURSES.hebrew, lecture, 'audio.mp3');
  await call(`${base}/run/transcribe`, { method: 'POST' });
  await waitForFile(COURSES.hebrew, lecture, 'transcript.txt');
  const { body } = await call(
    `${DATABASE}/courses/${encodeURIComponent(COURSES.hebrew)}/lectures/${encodeURIComponent(lecture)}/files/transcript.txt`,
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

const CHECKS = [
  ['fakes up', theFakesAnswer],
  ['escape alarm (python)', pythonEscapeRefused],
  ['escape alarm + site redirect (node)', nodeEscapeRefusedAndSiteRedirected],
  ['no real key in any service', noRealKeyInTheServices],
  ['settings writes miss the real .env', settingsWritesMissTheRealEnv],
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
