#!/usr/bin/env node
// Build the offline harness, launch the app on it, and prove the harness before handing over.
// Everything it makes lives under one scratch root; nothing it does touches the real DATA_ROOT,
// the repo-root .env, or the network. Run it, leave it running, drive the app at :5173.
//
//   node .claude/hunt-bugs/setup.mjs [--harness DIR] [--no-launch] [--skip-pipeline-check]
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  BANNER,
  FAKE_COURSE_URL,
  FAKE_KEYS,
  FAKE_WSTOKEN,
  HUNT_ROOT,
  PORTS,
  REPO_ROOT,
  SCRATCH_MARKER,
  defaultRoot,
  harnessPaths,
  isScratchData,
  nodeEnv,
  pythonEnv,
} from './lib/env.mjs';
import { seed } from './lib/seed.mjs';
import { selfCheck } from './lib/selfcheck.mjs';
import { logOf, portOwners, start, stopAll, stopPortOwners, waitFor } from './lib/stack.mjs';

const run = promisify(execFile);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

const paths = harnessPaths(path.resolve(value('--harness', process.env.HUNT_BUGS_HARNESS ?? defaultRoot())));

// A 20-second clip: long enough that the audio step does real ffmpeg work and the UI shows a
// duration, short enough that a full run is seconds rather than minutes.
const VIDEO_ARGS = [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=20',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest',
];

// A valid one-page PDF, written by hand: the material path only needs bytes a PDF reader accepts,
// and generating one through pandoc would make the harness depend on the tool it is testing.
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 58>>stream
BT /F1 18 Tf 72 760 Td (hunt-bugs fixture handout) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
`;

function say(line) {
  console.log(line);
}

async function buildHarness() {
  for (const dir of [paths.root, paths.data, paths.state, paths.logs, paths.evidence, paths.fixtures, paths.bin, paths.drive, paths.tls]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // The guard the whole harness rests on: it runs against a data root it made, and nothing else.
  const marker = path.join(paths.data, SCRATCH_MARKER);
  if (fs.readdirSync(paths.data).length && !fs.existsSync(marker)) {
    throw new Error(`${paths.data} is not a hunt-bugs scratch tree — refusing to run against it`);
  }
  fs.writeFileSync(marker, `${BANNER}\n`);
  fs.writeFileSync(path.join(paths.root, 'README.txt'), `${BANNER}\n`);

  fs.copyFileSync(path.join(HUNT_ROOT, 'fixtures', 'transcript.txt'), path.join(paths.fixtures, 'transcript.txt'));
  fs.copyFileSync(path.join(HUNT_ROOT, 'fixtures', 'summary.md'), path.join(paths.fixtures, 'summary.md'));
  fs.writeFileSync(path.join(paths.fixtures, 'handout.pdf'), MINIMAL_PDF);

  const video = path.join(paths.fixtures, 'video.mp4');
  if (!fs.existsSync(video)) await run('ffmpeg', [...VIDEO_ARGS, video]);

  if (!fs.existsSync(path.join(paths.tls, 'cert.pem'))) {
    await run('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-keyout', path.join(paths.tls, 'key.pem'),
      '-out', path.join(paths.tls, 'cert.pem'),
      '-subj', '/CN=hunt-bugs-fake-site',
    ]);
  }

  // The fake binaries, first on the downloader services' PATH. `toolPath()` hands back a bare
  // name in a dev run, so PATH is the whole mechanism — no production code has to know.
  for (const tool of ['curl', 'yt-dlp']) {
    const wrapper = path.join(paths.bin, tool);
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${process.execPath} ${path.join(HUNT_ROOT, 'fakes', 'tool.mjs')} ${tool} "$@"\n`);
    fs.chmodSync(wrapper, 0o755);
  }

  // The settings store the database service rewrites — a scratch copy, so driving the settings
  // screen can never reach the repo-root .env and its real keys.
  fs.writeFileSync(
    paths.env,
    [
      `# ${BANNER}`,
      `DATA_ROOT=${paths.data}`,
      `GROQ_API_KEY=${FAKE_KEYS.GROQ_API_KEY}`,
      `GEMINI_API_KEY=${FAKE_KEYS.GEMINI_API_KEY}`,
      'GEMINI_MODEL=gemini-2.5-flash',
      'GDRIVE_ROOT_FOLDER=HuntBugs',
      'DRIVE_ENABLED=true',
      'NIGHTLY_RUN=false',
      '',
    ].join('\n'),
  );

  // The environment each half of the stack runs with, written out so one service can be killed
  // and restarted mid-sweep without reconstructing it by hand.
  for (const [name, env] of [['python', pythonEnv(paths)], ['node', nodeEnv(paths)]]) {
    const lines = Object.entries(env)
      .filter(([key, item]) => item !== process.env[key])
      .map(([key, item]) => `export ${key}=${JSON.stringify(item)}`);
    fs.writeFileSync(path.join(paths.root, `env-${name}.sh`), `# ${BANNER}\n${lines.join('\n')}\n`);
  }

  // The Moodle WS token, pre-seeded: the real one arrives through a headed login with MFA by hand,
  // which no offline run can produce. Everything downstream of the token is the real code.
  const tokenPath = path.join(paths.state, 'auth', 'biu-token.json');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(
    tokenPath,
    JSON.stringify({ wstoken: FAKE_WSTOKEN, privatetoken: 'hunt-bugs-private', savedAt: new Date().toISOString() }),
  );
}

function startFakes() {
  const env = { ...nodeEnv(paths), HUNT_BUGS_WSTOKEN: FAKE_WSTOKEN, NODE_OPTIONS: '' };
  start('fake-providers', process.execPath, [path.join(HUNT_ROOT, 'fakes', 'providers.mjs')], { cwd: HUNT_ROOT, env, paths });
  start('fake-site', process.execPath, [path.join(HUNT_ROOT, 'fakes', 'site.mjs')], { cwd: HUNT_ROOT, env, paths });
}

function startServices() {
  const py = pythonEnv(paths);
  const node = nodeEnv(paths);
  start('database', 'uv', ['run', 'uvicorn', 'database_main:app', '--host', '127.0.0.1', '--port', String(PORTS.database)], {
    cwd: path.join(REPO_ROOT, 'database'),
    env: py,
    paths,
  });
  start('backend', 'uv', ['run', 'uvicorn', 'backend_main:app', '--host', '127.0.0.1', '--port', String(PORTS.backend)], {
    cwd: path.join(REPO_ROOT, 'backend'),
    env: py,
    paths,
  });
  start('downloader-server', 'npm', ['start'], { cwd: path.join(REPO_ROOT, 'downloader', 'server'), env: node, paths });
  start('downloader-auto', 'npm', ['start'], { cwd: path.join(REPO_ROOT, 'downloader', 'auto'), env: node, paths });
  // No shim on the dev server: it serves the SPA and talks to nobody, and NODE_OPTIONS would ride
  // into every tool vite spawns.
  start('frontend', 'npm', ['run', 'dev'], {
    cwd: path.join(REPO_ROOT, 'frontend'),
    env: { ...process.env, DATA_ROOT: paths.data },
    paths,
  });
}

async function waitForEverything() {
  await waitFor('fake providers', `http://127.0.0.1:${PORTS.providers}/health`, { logFile: logOf('fake-providers') });
  await waitFor('fake site', `http://127.0.0.1:${PORTS.site}/health`, { logFile: logOf('fake-site') });
  await waitFor('database', `http://127.0.0.1:${PORTS.database}/health`, { logFile: logOf('database') });
  await waitFor('backend', `http://127.0.0.1:${PORTS.backend}/health`, { logFile: logOf('backend') });
  await waitFor('downloader server', `http://127.0.0.1:${PORTS.server}/health`, { logFile: logOf('downloader-server') });
  await waitFor('auto-downloader', `http://127.0.0.1:${PORTS.auto}/health`, { logFile: logOf('downloader-auto') });
  await waitFor('frontend', `http://127.0.0.1:${PORTS.frontend}/`, { logFile: logOf('frontend') });
}

function reportTools() {
  return Promise.all(
    [
      ['backend', PORTS.backend],
      ['downloader server', PORTS.server],
      ['auto-downloader', PORTS.auto],
    ].map(async ([name, port]) => {
      const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
      const tools = Object.entries(health.tools ?? {})
        .map(([tool, state]) => `${tool}=${state}`)
        .join(' ');
      return `  ${name}: ${tools || 'no tools'}`;
    }),
  );
}

// Every port the harness needs. A stack already on one of them would answer /health and pass for
// this run's — with somebody else's data root, fakes and fixtures behind it.
async function preflightPorts() {
  if (flag('--stop')) {
    const stopped = stopPortOwners(PORTS);
    if (stopped.length) say(`  ✓ stopped what held the harness ports: ${stopped.join(', ')}`);
    const deadline = Date.now() + 15_000;
    while (portOwners(PORTS).length && Date.now() < deadline) await sleep(500);
  }
  const busy = portOwners(PORTS);
  if (busy.length) {
    const lines = busy.map((owner) => `  :${owner.port} (${owner.name}) held by pid ${owner.pid} — ${owner.command}`);
    throw new Error(
      `these ports are already in use, most likely a previous harness or a plain \`npm run dev\`:\n${lines.join('\n')}\n` +
        'Stop it, or re-run with --stop to have the harness terminate them first.',
    );
  }
}

async function main() {
  say(`hunt-bugs: ${BANNER}`);
  say(`harness root: ${paths.root}`);

  await preflightPorts();

  await buildHarness();
  say('  ✓ fixtures, fake binaries, scratch .env and Moodle token written');

  startFakes();
  await waitFor('fake providers', `http://127.0.0.1:${PORTS.providers}/health`, { logFile: logOf('fake-providers') });
  await waitFor('fake site', `http://127.0.0.1:${PORTS.site}/health`, { logFile: logOf('fake-site') });
  say(`  ✓ fakes up: providers :${PORTS.providers}, lecture site :${PORTS.site} (:${PORTS.siteTls} tls)`);

  if (flag('--no-launch')) {
    say(`\nLaunch the stack yourself, sourcing the environment it needs:
  . ${path.join(paths.root, 'env-python.sh')}   # before database/ and backend/
  . ${path.join(paths.root, 'env-node.sh')}     # before downloader/server and downloader/auto`);
    return keepRunning();
  }

  startServices();
  await waitForEverything();
  say('  ✓ database, backend, downloader server, auto-downloader and the dev server all answering');
  for (const line of await reportTools()) say(line);

  if (!isScratchData(paths.data)) throw new Error('the data root lost its scratch marker — refusing to seed');
  if (flag('--reseed')) {
    for (const entry of fs.readdirSync(paths.data)) {
      if (entry !== SCRATCH_MARKER) fs.rmSync(path.join(paths.data, entry), { recursive: true, force: true });
    }
  }
  // Re-running against the same harness keeps whatever the last sweep left, which is often the
  // point — a bug reproduced on the state that produced it. --reseed wipes back to the fixtures.
  const existing = fs.readdirSync(paths.data).filter((entry) => entry !== SCRATCH_MARKER);
  if (existing.length) {
    say(`  ✓ reusing the scratch data already in ${paths.data} (${existing.length} courses; --reseed to start over)`);
  } else {
    const seeded = await seed(paths);
    say(`  ✓ seeded ${seeded.courses} courses / ${seeded.lectures} lectures into ${paths.data}`);
  }

  say('\nproving the harness:');
  await selfCheck(paths, { skipPipeline: flag('--skip-pipeline-check') });

  say(`
harness ready — drive the app at http://127.0.0.1:${PORTS.frontend}

  logs        ${paths.logs}          (network.log lists every redirected and refused connection)
  env files   ${paths.root}/env-{python,node}.sh  (source one to restart a single service)
  evidence    ${paths.evidence}      (put screenshots and traces here)
  scratch data${'  '}${paths.data}
  drive       ${paths.drive}         (store.json + ops.jsonl: what "upload to Drive" did)

  fake course URL for the downloads page:
    ${FAKE_COURSE_URL}

  drive a failure without waiting for a real one:
    curl -s localhost:${PORTS.providers}/control -d '{"gemini":"429"}'    # quota exhausted
    curl -s localhost:${PORTS.providers}/control -d '{"groq":"500"}'      # provider outage
    curl -s localhost:${PORTS.providers}/control -d '{"gemini":"ok","groq":"ok"}'
    curl -s localhost:${PORTS.site}/control -d '{"mode":"blocked"}'       # bot-protection challenge
    curl -s localhost:${PORTS.site}/control -d '{"mode":"invalidtoken"}'  # the Moodle token died
    curl -s localhost:${PORTS.site}/control -d '{"mode":"ok"}'

  not covered by this harness: the Electron shell, the installer, real provider behaviour,
  the headed Moodle/zoom logins and MFA, and zoom capture (it needs a real browser).

Ctrl-C stops every service and fake.`);
  return keepRunning();
}

function keepRunning() {
  return new Promise(() => {});
}

// Includes the EPIPE a closed pipe raises out of a `say`: without this the detached children of a
// setup that died writing its output would outlive it, and the next run would find the ports held.
process.on('uncaughtException', (error) => {
  console.error(`\nhunt-bugs stopped: ${error.message}`);
  stopAll();
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    say('\nhunt-bugs: stopping every service and fake');
    stopAll();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(`\nhunt-bugs failed: ${error.message}`);
  stopAll();
  process.exit(1);
});
