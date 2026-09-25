#!/usr/bin/env node
// Build the offline harness, launch the app on it, and prove the harness before handing over.
// Everything it makes lives under one scratch root; nothing it does touches the real DATA_ROOT,
// the repo-root .env, or the network. Run it, leave it running, drive the app at :5173.
//
//   node .claude/hunt-bugs/setup.mjs [--harness DIR] [--browsers mgmt,nav…] [--no-launch] [--skip-pipeline-check]
//   node .claude/hunt-bugs/setup.mjs --harness DIR --down
//   node .claude/hunt-bugs/setup.mjs --harness DIR --restart <service> [ENV=val…]
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  BANNER,
  BROWSER_PORTS,
  FAKE_COURSE_URL,
  FAKE_WSTOKEN,
  HUNT_ROOT,
  PORTS,
  REPO_ROOT,
  SCRATCH_MARKER,
  defaultRoot,
  harnessPaths,
  nodeEnv,
  pythonEnv,
} from './lib/env.mjs';
import { markSeeded, reseed, writeMoodleToken, writeScratchEnv } from './lib/baseline.mjs';
import { selfCheck } from './lib/selfcheck.mjs';
import {
  down,
  portOwners,
  resetStack,
  restart,
  start,
  startBrowser,
  stopPortOwners,
  waitForService,
} from './lib/stack.mjs';

const run = promisify(execFile);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

// The flows to open a browser session for, checked before anything starts.
const browsers = value('--browsers', '').split(',').filter(Boolean);
for (const tag of browsers) {
  if (!BROWSER_PORTS[tag]) {
    console.error(
      `hunt-bugs: no browser port for "${tag}" (known: ${Object.keys(BROWSER_PORTS).join(', ')})`,
    );
    process.exit(2);
  }
}

const paths = harnessPaths(
  path.resolve(value('--harness', process.env.HUNT_BUGS_HARNESS ?? defaultRoot())),
);

// A 20-second clip: long enough that the audio step does real ffmpeg work and the UI shows a
// duration, short enough that a full run is seconds rather than minutes.
const VIDEO_ARGS = [
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=640x360:rate=15:duration=20',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=20',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-shortest',
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
  for (const dir of [
    paths.root,
    paths.data,
    paths.dataEmpty,
    paths.state,
    paths.logs,
    paths.evidence,
    paths.fragments,
    paths.fixtures,
    paths.bin,
    paths.drive,
    paths.tls,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // The guard the whole harness rests on: it runs against a data root it made, and nothing else.
  const marker = path.join(paths.data, SCRATCH_MARKER);
  if (fs.readdirSync(paths.data).length && !fs.existsSync(marker)) {
    throw new Error(`${paths.data} is not a hunt-bugs scratch tree — refusing to run against it`);
  }
  fs.writeFileSync(marker, `${BANNER}\n`);
  fs.writeFileSync(path.join(paths.dataEmpty, SCRATCH_MARKER), `${BANNER}\n`);
  fs.writeFileSync(path.join(paths.root, 'README.txt'), `${BANNER}\n`);

  fs.copyFileSync(
    path.join(HUNT_ROOT, 'fixtures', 'transcript.txt'),
    path.join(paths.fixtures, 'transcript.txt'),
  );
  fs.copyFileSync(
    path.join(HUNT_ROOT, 'fixtures', 'summary.md'),
    path.join(paths.fixtures, 'summary.md'),
  );
  fs.writeFileSync(path.join(paths.fixtures, 'handout.pdf'), MINIMAL_PDF);

  const video = path.join(paths.fixtures, 'video.mp4');
  if (!fs.existsSync(video)) await run('ffmpeg', [...VIDEO_ARGS, video]);

  if (!fs.existsSync(path.join(paths.tls, 'cert.pem'))) {
    await run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '3650',
      '-keyout',
      path.join(paths.tls, 'key.pem'),
      '-out',
      path.join(paths.tls, 'cert.pem'),
      '-subj',
      '/CN=hunt-bugs-fake-site',
    ]);
  }

  // The fake binaries, first on the downloader services' PATH. `toolPath()` hands back a bare
  // name in a dev run, so PATH is the whole mechanism — no production code has to know. No shim:
  // they talk only to loopback, and its banner on stderr would land in a failed job's `detail`.
  for (const tool of ['curl', 'yt-dlp']) {
    const wrapper = path.join(paths.bin, tool);
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\nNODE_OPTIONS= exec ${process.execPath} ${path.join(HUNT_ROOT, 'fakes', 'tool.mjs')} ${tool} "$@"\n`,
    );
    fs.chmodSync(wrapper, 0o755);
  }

  // The settings store the database service rewrites — a scratch copy, so driving the settings
  // screen can never reach the repo-root .env and its real keys.
  writeScratchEnv(paths);

  // The environment each half of the stack runs with, written out so one service can be killed
  // and restarted mid-sweep without reconstructing it by hand.
  for (const [name, env] of [
    ['python', pythonEnv(paths)],
    ['node', nodeEnv(paths)],
  ]) {
    const lines = Object.entries(env)
      .filter(([key, item]) => item !== process.env[key])
      .map(([key, item]) => `export ${key}=${JSON.stringify(item)}`);
    fs.writeFileSync(path.join(paths.root, `env-${name}.sh`), `# ${BANNER}\n${lines.join('\n')}\n`);
  }

  writeMoodleToken(paths);
}

function startFakes() {
  const env = { ...nodeEnv(paths), HUNT_BUGS_WSTOKEN: FAKE_WSTOKEN, NODE_OPTIONS: '' };
  start('fake-providers', process.execPath, [path.join(HUNT_ROOT, 'fakes', 'providers.mjs')], {
    cwd: HUNT_ROOT,
    env,
    paths,
    health: `http://127.0.0.1:${PORTS.providers}/health`,
  });
  start('fake-site', process.execPath, [path.join(HUNT_ROOT, 'fakes', 'site.mjs')], {
    cwd: HUNT_ROOT,
    env,
    paths,
    health: `http://127.0.0.1:${PORTS.site}/health`,
  });
}

function startServices() {
  const py = pythonEnv(paths);
  const node = nodeEnv(paths);
  start(
    'database',
    'uv',
    [
      'run',
      'uvicorn',
      'database_main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORTS.database),
    ],
    {
      cwd: path.join(REPO_ROOT, 'database'),
      env: py,
      paths,
      health: `http://127.0.0.1:${PORTS.database}/health`,
    },
  );
  start(
    'backend',
    'uv',
    ['run', 'uvicorn', 'backend_main:app', '--host', '127.0.0.1', '--port', String(PORTS.backend)],
    {
      cwd: path.join(REPO_ROOT, 'backend'),
      env: py,
      paths,
      health: `http://127.0.0.1:${PORTS.backend}/health`,
    },
  );
  start('downloader-server', 'npm', ['start'], {
    cwd: path.join(REPO_ROOT, 'downloader', 'server'),
    env: node,
    paths,
    health: `http://127.0.0.1:${PORTS.server}/health`,
  });
  start('downloader-auto', 'npm', ['start'], {
    cwd: path.join(REPO_ROOT, 'downloader', 'auto'),
    env: node,
    paths,
    health: `http://127.0.0.1:${PORTS.auto}/health`,
  });
  // No shim on the dev server: it serves the SPA and talks to nobody, and NODE_OPTIONS would ride
  // into every tool vite spawns.
  start('frontend', 'npm', ['run', 'dev'], {
    cwd: path.join(REPO_ROOT, 'frontend'),
    env: { ...process.env, DATA_ROOT: paths.data },
    paths,
    health: `http://127.0.0.1:${PORTS.frontend}/`,
  });
}

async function waitForEverything() {
  for (const name of ['database', 'backend', 'downloader-server', 'downloader-auto', 'frontend'])
    await waitForService(paths, name);
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
    await down(paths);
    const stopped = stopPortOwners(PORTS);
    if (stopped.length) say(`  ✓ stopped what held the harness ports: ${stopped.join(', ')}`);
    const deadline = Date.now() + 15_000;
    while (portOwners(PORTS).length && Date.now() < deadline) await sleep(500);
  }
  const busy = portOwners(PORTS);
  if (busy.length) {
    const lines = busy.map(
      (owner) => `  :${owner.port} (${owner.name}) held by pid ${owner.pid} — ${owner.command}`,
    );
    throw new Error(
      `these ports are already in use, most likely a previous harness or a plain \`npm run dev\`:\n${lines.join('\n')}\n` +
        'Stop it, or re-run with --stop to have the harness terminate them first.',
    );
  }
}

// Set once this run has started anything: a run that fails before that must not tear down the stack
// another setup recorded under the same harness root.
let launched = false;

async function main() {
  if (flag('--down')) {
    const stopped = await down(paths);
    say(
      stopped.length
        ? `hunt-bugs: stopped ${stopped.join(', ')}`
        : `hunt-bugs: no stack recorded under ${paths.root}`,
    );
    return;
  }
  if (flag('--restart')) {
    const name = value('--restart');
    const overrides = Object.fromEntries(
      args
        .filter((arg) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))
        .map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]),
    );
    await restart(paths, name, overrides);
    say(`hunt-bugs: restarted ${name}`);
    return;
  }

  say(`hunt-bugs: ${BANNER}`);
  say(`harness root: ${paths.root}`);

  await preflightPorts();

  await buildHarness();
  say('  ✓ fixtures, fake binaries, scratch .env and Moodle token written');

  resetStack(paths);
  launched = true;
  startFakes();
  await waitForService(paths, 'fake-providers');
  await waitForService(paths, 'fake-site');
  say(
    `  ✓ fakes up: providers :${PORTS.providers}, lecture site :${PORTS.site} (:${PORTS.siteTls} tls)`,
  );

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

  // Re-running against the same harness keeps whatever the last sweep left, which is often the
  // point — a bug reproduced on the state that produced it. --reseed restores the baseline too.
  const existing = fs.readdirSync(paths.data).filter((entry) => entry !== SCRATCH_MARKER);
  const seeding = flag('--reseed') || !existing.length;
  if (seeding) {
    const seeded = await reseed(paths);
    say(`  ✓ seeded ${seeded.courses} courses / ${seeded.lectures} lectures into ${paths.data}`);
  } else {
    say(
      `  ✓ reusing the scratch data already in ${paths.data} (${existing.length} courses; --reseed to start over)`,
    );
  }

  say('\nproving the harness:');
  await selfCheck(paths, { skipPipeline: flag('--skip-pipeline-check') });
  // After the self-check, so the lecture it ran on is part of the baseline `hb state` diffs against.
  if (seeding) await markSeeded(paths);

  for (const tag of browsers) await startBrowser(paths, tag, BROWSER_PORTS[tag]);
  if (browsers.length) {
    say(
      `  ✓ browser sessions: ${browsers.map((tag) => `${tag} :${BROWSER_PORTS[tag]}`).join(', ')}`,
    );
  }

  say(`
harness ready — drive the app at http://localhost:${PORTS.frontend}  (localhost, not 127.0.0.1: the services' CORS allowlists name only localhost)

  logs        ${paths.logs}          (network.log lists every redirected and refused connection)
  restart     node .claude/hunt-bugs/setup.mjs --harness ${paths.root} --restart <service> [ENV=val…]
  stop        Ctrl-C here, or the same with --down
  helpers     node .claude/hunt-bugs/hb.mjs --harness ${paths.root} help   (set, reseed, state, wall, lock, add-material, rm-lecture, refused…)
  browsers    node .claude/hunt-bugs/hb.mjs --harness ${paths.root} browser <tag>   (one more session; README lists its commands)
  evidence    ${paths.evidence}      (screenshots, <tag>-mutations.jsonl)
  fragments   ${paths.fragments}     (one <tag>.md per flow agent; hb brief / hb findings)
  scratch data${'  '}${paths.data}
  empty root  ${paths.dataEmpty}    (marked, for the data-folder switch)
  drive       ${paths.drive}         (store.json + ops.jsonl: what "upload to Drive" did)

  fake course URL for the downloads page:
    ${FAKE_COURSE_URL}

  drive a failure without waiting for a real one:
    curl -s localhost:${PORTS.providers}/control -d '{"gemini":"429"}'    # quota exhausted
    curl -s localhost:${PORTS.providers}/control -d '{"groq":"500"}'      # provider outage
    curl -s localhost:${PORTS.providers}/control -d '{"gemini":{"mode":"429","match":"hb-fail/שיעור 4","times":1}}'
    curl -s localhost:${PORTS.providers}/control -d '{"gemini":"ok","groq":"ok"}'
    curl -s localhost:${PORTS.site}/control -d '{"mode":"blocked"}'       # bot-protection challenge
    curl -s localhost:${PORTS.site}/control -d '{"mode":"invalidtoken"}'  # the Moodle token died
    curl -s localhost:${PORTS.site}/control -d '{"mode":"ok"}'
    curl -s localhost:${PORTS.site}/control -d '{"downloadMs":60000}'     # slow downloads, live

  not covered by this harness: the Electron shell, the installer, real provider behaviour,
  the headed Moodle/zoom logins and MFA, and zoom capture (it needs a real browser).

Ctrl-C stops every service and fake.`);
  return keepRunning();
}

// A pending promise alone does not keep Node alive, and every child is unref'd — without a live
// timer the process would exit here and leave the stack orphaned.
function keepRunning() {
  setInterval(() => {}, 1 << 30);
}

async function teardown(code) {
  if (launched) await down(paths);
  process.exit(code);
}

// Includes the EPIPE a closed pipe raises out of a `say`: without this the detached children of a
// setup that died writing its output would outlive it, and the next run would find the ports held.
process.on('uncaughtException', (error) => {
  console.error(`\nhunt-bugs stopped: ${error.message}`);
  teardown(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (launched) say('\nhunt-bugs: stopping every service and fake');
    teardown(0);
  });
}

main().catch((error) => {
  console.error(`\nhunt-bugs failed: ${error.message}`);
  teardown(1);
});
