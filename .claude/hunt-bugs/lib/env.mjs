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

export const SCRATCH_MARKER = '.hunt-bugs-scratch';

export const BANNER =
  'hunt-bugs harness: every provider, Google API, lecture site and download binary here is FAKE, ' +
  'and DATA_ROOT is a scratch tree. Nothing in this run reflects real data or a real service.';

/** Every path the harness owns, derived from one root. Creates nothing. */
export function harnessPaths(root) {
  const at = (...parts) => path.join(root, ...parts);
  return {
    root,
    data: at('data'),
    state: at('state'),
    logs: at('logs'),
    evidence: at('evidence'),
    fixtures: at('fixtures'),
    bin: at('bin'),
    drive: at('drive'),
    env: at('.env'),
    tls: at('tls'),
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
    // binary a download spawns — the fake ones, which never open a socket.
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
