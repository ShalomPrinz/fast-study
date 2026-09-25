// Where the harness puts everything, and what every child's environment looks like. One module,
// because the shims, the fakes and the self-checks all have to agree with the services on it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HUNT_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
export const REPO_ROOT = path.resolve(HUNT_ROOT, '../..');

// The dev ports, deliberately: the frontend falls back to exactly these when no preload bridge
// hands it URLs, so a harness run reaches the services the same way a plain `npm run dev` does.
export const PORTS = {
  database: 8001,
  backend: 8000,
  server: 3052,
  auto: 3053,
  frontend: 5173,
  providers: 4598, // fake Groq + Gemini
  site: 4599, // fake lecture site, http
  siteTls: 4699, // the same site over TLS, where the socket redirect sends :443
};

// One browser session per flow (browser.mjs), each on a known port; another tag names its own.
export const BROWSER_PORTS = {
  mgmt: 4710,
  dl: 4711,
  edit: 4712,
  nav: 4713,
  pipeline: 4714,
  fail: 4715,
  settings: 4716,
};

// The flows a wave runs, by browser tag: the Step 2 sweep items each owns and its seeded course.
// Their order is the merged findings file's order.
export const FLOWS = {
  settings: { title: 'Settings', sweep: '1', course: null },
  mgmt: { title: 'Course and lecture management', sweep: '2', course: 'hb-mgmt' },
  dl: { title: 'Downloads', sweep: '3', course: 'hb-dl' },
  pipeline: { title: 'Pipeline and course overview', sweep: '4 and 7', course: 'hb-pipeline' },
  fail: { title: 'Failure surfacing', sweep: '5', course: 'hb-fail' },
  edit: { title: 'Editor and PDF', sweep: '6', course: 'hb-edit' },
  nav: { title: 'Search, materials, other links, navigation', sweep: '8', course: 'hb-nav' },
};

// Recognisable on sight in a log, a header or an error, and shaped like the real thing so the
// providers' own prefix validation still runs.
export const FAKE_KEYS = {
  GROQ_API_KEY: 'gsk_huntbugsFAKEkeyNeverReal000000000000000000000000000000',
  GEMINI_API_KEY: 'AIzaHuntBugsFAKEkeyNeverReal0000000000',
};

// The Moodle WS token the fake site accepts; seeded into the state root so /auth/status reads
// connected without the headed MFA grab that only a human can finish.
export const FAKE_WSTOKEN = 'huntbugswstoken0000000000000000';

// The one course URL the fake site answers for. A biu.ac.il host on purpose: auto/'s registry
// routes auth by hostname, so a loopback URL would find no university at all.
export const FAKE_COURSE_URL = 'https://lemida.biu.ac.il/course/view.php?id=101';

// The fake course's failure rows, by URL switch → title: the site lists them, the self-check
// proves each one is in the real listing. /deny/ and /die/ list as recordings and fail in the tool.
export const FAILURE_ROWS = {
  gone: 'הקלטה 9 — הוסרה',
  deny: 'הקלטה 7 — גישה נחסמה',
  die: 'הקלטה 8 — נקטעת באמצע',
};

// How long the fake tool takes over one download until `/control` says otherwise.
export const DEFAULT_DOWNLOAD_MS = 3000;

export const SCRATCH_MARKER = '.hunt-bugs-scratch';

// The service name the self-check's escape probes log under in network.log.
export const SELFCHECK_TAG = 'selfcheck';

export const BANNER =
  'hunt-bugs harness: every provider, Google API, lecture site and download binary here is FAKE, ' +
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
    // One findings fragment per flow agent, `<tag>.md`, joined by `hb findings`.
    fragments: at('fragments'),
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
  };
}

/** A default root under the system temp dir, stamped so two runs never share evidence. */
export function defaultRoot() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(os.tmpdir(), 'faststudy-hunt', stamp);
}

/** The environment shared by every child: fake keys, scratch roots, and where the fakes listen. */
function baseEnv(paths) {
  return {
    ...process.env,
    ...FAKE_KEYS,
    DATA_ROOT: paths.data,
    FASTSTUDY_STATE_DIR: paths.state,
    HUNT_BUGS_HARNESS: paths.root,
    HUNT_BUGS_PROVIDERS: `http://127.0.0.1:${PORTS.providers}`,
    HUNT_BUGS_SITE: `http://127.0.0.1:${PORTS.site}`,
    HUNT_BUGS_SITE_TLS: `https://127.0.0.1:${PORTS.siteTls}`,
    GDRIVE_ROOT_FOLDER: 'HuntBugs',
    DRIVE_ENABLED: 'true',
    // Off by default: a cron firing mid-sweep would attribute its runs to whatever the agent
    // happened to be doing. The agent turns it on deliberately when testing the nightly pass.
    NIGHTLY_RUN: 'false',
  };
}

/** The Python services: the shim rides in on PYTHONPATH, which needs no production change. */
export function pythonEnv(paths) {
  const shim = path.join(HUNT_ROOT, 'shim');
  const existing = process.env.PYTHONPATH;
  return {
    ...baseEnv(paths),
    PYTHONPATH: existing ? `${shim}${path.delimiter}${existing}` : shim,
    PYTHONUNBUFFERED: '1',
  };
}

/** The Node services: the shim through --import, the fake binaries first on PATH. */
export function nodeEnv(paths) {
  const shim = path.join(HUNT_ROOT, 'shim', 'node.mjs');
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

/** True when this data root is one the harness made, which is the only one it will run against. */
export function isScratchData(dir) {
  return fs.existsSync(path.join(dir, SCRATCH_MARKER));
}
