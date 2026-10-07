#!/usr/bin/env node
// Build the offline harness, launch the app on it, and prove the harness before handing over.
// Everything it makes lives under one scratch root, ports included, so stacks run side by side;
// nothing it does touches the real DATA_ROOT, the repo-root .env, or the network.
//
//   node .claude/harness/setup.mjs [--harness DIR] [--browsers main,…] [--skip-pipeline-check]
//   node .claude/harness/setup.mjs --harness DIR --down
//   node .claude/harness/setup.mjs --harness DIR --restart <service> [ENV=val…]
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { bindPorts, call } from './lib/api.mjs';
import { appServices, appUrl } from './lib/browser.mjs';
import {
  BANNER,
  FAKE_COURSE_URL,
  FAKE_WSTOKEN,
  HARNESS_ROOT,
  PORTS,
  REPO_ROOT,
  SCRATCH_MARKER,
  defaultRoot,
  harnessPaths,
  nodeEnv,
  pythonEnv,
  readPorts,
} from './lib/env.mjs';
import {
  markSeeded,
  pushSettings,
  reseed,
  writeMoodleToken,
  writeScratchEnv,
} from './lib/baseline.mjs';
import { selfCheck } from './lib/selfcheck.mjs';
import {
  down,
  liveHolder,
  resetStack,
  restart,
  start,
  startBrowser,
  waitForService,
} from './lib/stack.mjs';

const run = promisify(execFile);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

// The tags to open a browser session for, each on a port of its own.
const browsers = value('--browsers', '').split(',').filter(Boolean);

const paths = harnessPaths(
  path.resolve(value('--harness', process.env.HARNESS_DIR ?? defaultRoot())),
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
BT /F1 18 Tf 72 760 Td (harness fixture handout) Tj ET
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
    throw new Error(`${paths.data} is not a harness scratch tree — refusing to run against it`);
  }
  fs.writeFileSync(marker, `${BANNER}\n`);
  fs.writeFileSync(path.join(paths.dataEmpty, SCRATCH_MARKER), `${BANNER}\n`);
  fs.writeFileSync(path.join(paths.root, 'README.txt'), `${BANNER}\n`);

  fs.copyFileSync(
    path.join(HARNESS_ROOT, 'fixtures', 'transcript.txt'),
    path.join(paths.fixtures, 'transcript.txt'),
  );
  fs.copyFileSync(
    path.join(HARNESS_ROOT, 'fixtures', 'summary.md'),
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
      '/CN=harness-fake-site',
    ]);
  }

  // The fake binaries, first on the downloader services' PATH. `toolPath()` hands back a bare
  // name in a dev run, so PATH is the whole mechanism — no production code has to know. No shim:
  // they talk only to loopback, and its banner on stderr would land in a failed job's `detail`.
  for (const tool of ['curl', 'yt-dlp']) {
    const wrapper = path.join(paths.bin, tool);
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\nNODE_OPTIONS= exec ${process.execPath} ${path.join(HARNESS_ROOT, 'fakes', 'tool.mjs')} ${tool} "$@"\n`,
    );
    fs.chmodSync(wrapper, 0o755);
  }

  // The settings store the database service rewrites — a scratch copy, so driving the settings
  // screen can never reach the repo-root .env and its real keys.
  writeScratchEnv(paths);

  writeMoodleToken(paths);
}

// The environment each half of the stack runs with, as of the ports reported so far, so one
// service can be launched by hand against this stack.
function writeEnvFiles() {
  for (const [name, env] of [
    ['python', pythonEnv(paths)],
    ['node', nodeEnv(paths)],
  ]) {
    const lines = Object.entries(env)
      .filter(([key, item]) => item !== process.env[key])
      .map(([key, item]) => `export ${key}=${JSON.stringify(item)}`);
    fs.writeFileSync(path.join(paths.root, `env-${name}.sh`), `# ${BANNER}\n${lines.join('\n')}\n`);
  }
}

// Each reported port, into `PORTS` for later spawns' env and merged into ports.json, keeping browser-<tag> for reuse.
function record(ports) {
  bindPorts(paths, ports);
  fs.writeFileSync(paths.ports, JSON.stringify({ ...readPorts(paths), ...PORTS }));
}

// The ports the last run on this root reported, tried first so the links its seed wrote stay valid.
let previous = {};

async function startFakes() {
  const env = { ...nodeEnv(paths), HARNESS_WSTOKEN: FAKE_WSTOKEN, NODE_OPTIONS: '' };
  const providers = await start(
    'fake-providers',
    process.execPath,
    [path.join(HARNESS_ROOT, 'fakes', 'providers.mjs')],
    { cwd: HARNESS_ROOT, env, paths, want: { FASTSTUDY_PORT: previous.providers } },
  );
  record({ providers: providers.FASTSTUDY_PORT });
  const site = await start(
    'fake-site',
    process.execPath,
    [path.join(HARNESS_ROOT, 'fakes', 'site.mjs')],
    {
      cwd: HARNESS_ROOT,
      env,
      paths,
      want: { FASTSTUDY_PORT: previous.site, HARNESS_SITE_TLS_PORT: previous.siteTls },
      reports: {
        FASTSTUDY_PORT: '^FASTSTUDY_PORT=(\\d+)$',
        HARNESS_SITE_TLS_PORT: '^HARNESS_SITE_TLS_PORT=(\\d+)$',
      },
    },
  );
  record({ site: site.FASTSTUDY_PORT, siteTls: site.HARNESS_SITE_TLS_PORT });
}

// In dependency order, each one's env built after its peers reported, so it is handed their real URLs.
async function startServices() {
  const services = [
    ['database', 'database', 'uv', ['run', 'python', 'database_main.py'], 'database', pythonEnv],
    ['backend', 'backend', 'uv', ['run', 'python', 'backend_main.py'], 'backend', pythonEnv],
    ['downloader-auto', 'auto', 'npm', ['start'], path.join('downloader', 'auto'), nodeEnv],
    ['downloader-server', 'server', 'npm', ['start'], path.join('downloader', 'server'), nodeEnv],
  ];
  for (const [name, key, command, args, dir, envOf] of services) {
    const { FASTSTUDY_PORT: port } = await start(name, command, args, {
      cwd: path.join(REPO_ROOT, dir),
      env: envOf(paths),
      paths,
      want: { FASTSTUDY_PORT: previous[key] },
    });
    record({ [key]: port });
  }
  // No shim on the dev server (README, Ports); vite takes its port only as a flag and reports it
  // only in its banner, so a shell hands it FASTSTUDY_PORT.
  const app = appServices();
  const { FASTSTUDY_PORT: port } = await start(
    'frontend',
    'sh',
    ['-c', 'exec npm run dev -- --port "$FASTSTUDY_PORT" --strictPort'],
    {
      cwd: path.join(REPO_ROOT, 'frontend'),
      env: {
        ...process.env,
        DATA_ROOT: paths.data,
        NO_COLOR: '1',
        VITE_DATABASE_URL: app.database,
        VITE_BACKEND_URL: app.backend,
        VITE_DOWNLOAD_SERVER_URL: app['downloader-server'],
        VITE_AUTO_DOWNLOADER_URL: app['downloader-auto'],
      },
      paths,
      want: { FASTSTUDY_PORT: previous.frontend },
      reports: { FASTSTUDY_PORT: 'Local:\\s+http://localhost:(\\d+)/' },
      healthPath: '/',
    },
  );
  record({ frontend: port });
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

// One setup per harness root: a second would overwrite the first's stack record and orphan it.
function refuseSecondSetup() {
  const holder = liveHolder(paths);
  if (holder) {
    throw new Error(
      `setup pid ${holder} already holds ${paths.root} — use its stack, or stop it with --down first`,
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
        ? `harness: stopped ${stopped.join(', ')}`
        : `harness: no stack recorded under ${paths.root}`,
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
    bindPorts(paths);
    await pushSettings(paths, name, overrides);
    say(`harness: restarted ${name}`);
    return;
  }

  say(BANNER);
  say(`harness root: ${paths.root}`);

  refuseSecondSetup();
  previous = readPorts(paths);

  await buildHarness();
  say('  ✓ fixtures, fake binaries, scratch .env and Moodle token written');

  resetStack(paths);
  launched = true;
  await startFakes();
  await waitForService(paths, 'fake-providers');
  await waitForService(paths, 'fake-site');
  say(
    `  ✓ fakes up: providers :${PORTS.providers}, lecture site :${PORTS.site} (:${PORTS.siteTls} tls)`,
  );

  await startServices();
  await waitForEverything();
  writeEnvFiles();
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

  const sessions = [];
  for (const tag of browsers) sessions.push(`${tag} :${await startBrowser(paths, tag)}`);
  if (sessions.length) say(`  ✓ browser sessions: ${sessions.join(', ')}`);

  say(`
harness ready — drive the app at ${appUrl()}  (localhost, not 127.0.0.1: the services' dev CORS takes localhost only)

  ports       ${paths.ports}   (hb url <name> prints one: ${[...Object.keys(PORTS), 'browser-<tag>'].join(', ')})
  logs        ${paths.logs}          (network.log lists every redirected and refused connection)
  restart     node .claude/harness/setup.mjs --harness ${paths.root} --restart <service> [ENV=val…]
  stop        Ctrl-C here, or the same with --down
  helpers     node .claude/harness/hb.mjs --harness ${paths.root} help   (url, set, reseed, state, wall, lock, add-material, rm-lecture, refused…)
  browsers    node .claude/harness/hb.mjs --harness ${paths.root} browser <tag>   (one more session; README lists its commands)
  evidence    ${paths.evidence}      (screenshots, <tag>-mutations.jsonl)
  scratch data${'  '}${paths.data}
  empty root  ${paths.dataEmpty}    (marked, for the data-folder switch)
  drive       ${paths.drive}         (store.json + ops.jsonl: what "upload to Drive" did)

  fake course URL for the downloads page:
    ${FAKE_COURSE_URL}

  drive a failure without waiting for a real one:
    curl -s 127.0.0.1:${PORTS.providers}/control -d '{"gemini":"429"}'    # quota exhausted
    curl -s 127.0.0.1:${PORTS.providers}/control -d '{"groq":"500"}'      # provider outage
    curl -s 127.0.0.1:${PORTS.providers}/control -d '{"gemini":{"mode":"429","match":"hb-fail/שיעור 4","times":1}}'
    curl -s 127.0.0.1:${PORTS.providers}/control -d '{"gemini":"ok","groq":"ok"}'
    curl -s 127.0.0.1:${PORTS.site}/control -d '{"mode":"blocked"}'       # bot-protection challenge (blocked_ws: only the web-service API)
    curl -s 127.0.0.1:${PORTS.site}/control -d '{"mode":"invalidtoken"}'  # the Moodle token died
    curl -s 127.0.0.1:${PORTS.site}/control -d '{"mode":"not_moodle"}'    # the site probe: not a Moodle
    curl -s 127.0.0.1:${PORTS.site}/control -d '{"mode":"missing_function"}'  # Connect refused (also mobile_service_off, downloads_disabled)
    curl -s 127.0.0.1:${PORTS.site}/control -d '{"mode":"ok"}'
    curl -s 127.0.0.1:${PORTS.site}/control -d '{"downloadMs":60000}'     # slow downloads, live

  not covered by this harness: the Electron shell, the installer, real provider behaviour,
  a real site's SSO and MFA pages, the zoom login, and zoom capture (it needs a real browser).

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
  console.error(`\nharness stopped: ${error.message}`);
  teardown(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (launched) say('\nharness: stopping every service and fake');
    teardown(0);
  });
}

main().catch((error) => {
  console.error(`\nharness failed: ${error.message}`);
  teardown(1);
});
