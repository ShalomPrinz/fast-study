// Where the harness puts everything, and what every child's environment looks like. One module,
// because the shims, the fakes and the self-checks all have to agree with the services on it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HARNESS_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
export const REPO_ROOT = path.resolve(HARNESS_ROOT, '../..');

// Every port a stack listens on, by name. Each harness takes its own free set, so several stacks
// run side by side; `PORTS` is filled from `<harness>/ports.json` by `bindPorts` before any use.
export const PORT_NAMES = [
  'database',
  'backend',
  'server',
  'auto',
  'frontend',
  'providers', // fake Groq + Gemini
  'site', // fake lecture site, http
  'siteTls', // the same site over TLS, where the socket redirect sends :443
];
export const PORTS = {};

// Recognisable on sight in a log, a header or an error, and shaped like the real thing so the
// providers' own prefix validation still runs.
export const FAKE_KEYS = {
  GROQ_API_KEY: 'gsk_harnessFAKEkeyNeverReal0000000000000000000000000000000',
  GEMINI_API_KEY: 'AIzaHarnessFAKEkeyNeverReal00000000000',
};

// The Moodle WS token the fake site accepts and its launch.php hands out; seeded into the state
// root so /auth/status reads connected before anyone presses Connect.
export const FAKE_WSTOKEN = 'harnesswstoken00000000000000000';

// The Moodle site the fake answers as, and the baseline's configured site. A real university host on
// purpose: auto/ only lets its token reach URLs under the configured site, and the shim redirects it.
export const FAKE_MOODLE_SITE = 'https://lemida.biu.ac.il';

// The one course URL the fake site answers for.
export const FAKE_COURSE_URL = `${FAKE_MOODLE_SITE}/course/view.php?id=101`;

// The fake course's failure rows, by URL switch → title: the site lists them, the self-check
// proves each one is in the real listing. /deny/ and /die/ list as recordings and fail in the tool.
export const FAILURE_ROWS = {
  gone: 'הקלטה 9 — הוסרה',
  deny: 'הקלטה 7 — גישה נחסמה',
  die: 'הקלטה 8 — נקטעת באמצע',
};

// How long the fake tool takes over one download until `/control` says otherwise.
export const DEFAULT_DOWNLOAD_MS = 3000;

export const SCRATCH_MARKER = '.harness-scratch';

// The service name the self-check's escape probes log under in network.log.
export const SELFCHECK_TAG = 'selfcheck';

export const BANNER =
  'harness: every provider, Google API, lecture site and download binary here is FAKE, ' +
  'and DATA_ROOT is a scratch tree. Nothing in this run reflects real data or a real service.';

/** Every path the harness owns, derived from one root. Creates nothing. */
export function harnessPaths(root) {
  const at = (...parts) => path.join(root, ...parts);
  return {
    root,
    data: at('data'),
    // A second marked root, empty, for the data-folder switch.
    dataEmpty: at('data-empty'),
    state: at('state'),
    logs: at('logs'),
    evidence: at('evidence'),
    fixtures: at('fixtures'),
    bin: at('bin'),
    drive: at('drive'),
    env: at('.env'),
    tls: at('tls'),
    // What the app looked like right after the last seed, and at the last `hb state`.
    seedSnapshot: at('state-seed.json'),
    snapshot: at('state.json'),
    // Globs the database fails to write as Windows does a file held open (`hb lock`).
    locks: at('locks.json'),
    network: at('logs', 'network.log'),
    // This stack's ports, `browser-<tag>` sessions included (`hb url`).
    ports: at('ports.json'),
  };
}

/** A default root under the system temp dir, stamped so two runs never share evidence. */
export function defaultRoot() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(os.tmpdir(), 'faststudy-harness', stamp);
}

/** The environment shared by every child: fake keys, scratch roots, and where the fakes listen. */
function baseEnv(paths) {
  return {
    ...process.env,
    ...FAKE_KEYS,
    DATA_ROOT: paths.data,
    FASTSTUDY_STATE_DIR: paths.state,
    HARNESS_DIR: paths.root,
    HARNESS_PROVIDERS: `http://127.0.0.1:${PORTS.providers}`,
    HARNESS_PROVIDERS_PORT: String(PORTS.providers),
    HARNESS_SITE: `http://127.0.0.1:${PORTS.site}`,
    HARNESS_SITE_PORT: String(PORTS.site),
    HARNESS_SITE_TLS: `https://127.0.0.1:${PORTS.siteTls}`,
    HARNESS_SITE_TLS_PORT: String(PORTS.siteTls),
    // Where each service finds its peers, since none of them is on its default port.
    DATABASE_URL: `http://127.0.0.1:${PORTS.database}`,
    BACKEND_URL: `http://127.0.0.1:${PORTS.backend}`,
    AUTODL_URL: `http://127.0.0.1:${PORTS.auto}`,
    FRONTEND_URL: `http://localhost:${PORTS.frontend}`,
    GDRIVE_ROOT_FOLDER: 'Harness',
    DRIVE_ENABLED: 'true',
    // auto/ reads it at boot; set here so the repo-root .env's own never wins the dotenv race.
    MOODLE_SITE: FAKE_MOODLE_SITE,
    // Off by default: a cron firing mid-sweep would attribute its runs to whatever the agent
    // happened to be doing. The agent turns it on deliberately when testing the nightly pass.
    NIGHTLY_RUN: 'false',
  };
}

/** The Python services: the shim rides in on PYTHONPATH, which needs no production change. */
export function pythonEnv(paths) {
  const shim = path.join(HARNESS_ROOT, 'shim');
  const existing = process.env.PYTHONPATH;
  return {
    ...baseEnv(paths),
    PYTHONPATH: existing ? `${shim}${path.delimiter}${existing}` : shim,
    PYTHONUNBUFFERED: '1',
  };
}

/** The Node services: the shim through --import, the fake binaries first on PATH. */
export function nodeEnv(paths) {
  const shim = path.join(HARNESS_ROOT, 'shim', 'node.mjs');
  const existing = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : '';
  return {
    ...baseEnv(paths),
    NODE_OPTIONS: `${existing}--import "${pathToFileURL(shim)}"`,
    // toolPath() hands back a bare `curl`/`yt-dlp` in a dev run, so PATH is what decides which
    // binary a download spawns — the fake ones, which never fetch the site's files.
    PATH: `${paths.bin}${path.delimiter}${process.env.PATH}`,
    // The fake site's TLS listener is self-signed, and a redirected https:// request has to
    // survive the handshake. Harness-only; no production code ever sets this.
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
  };
}

/** This stack's recorded ports, `{}` before setup has allocated them. */
export function readPorts(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.ports, 'utf8'));
  } catch {
    return {};
  }
}

/** True when this data root is one the harness made, which is the only one it will run against. */
export function isScratchData(dir) {
  return fs.existsSync(path.join(dir, SCRATCH_MARKER));
}
