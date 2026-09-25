// The known state every sweep starts from — settings, both tokens, the fakes' modes, Drive — and the
// reseed that puts a live stack back into it. The scratch `.env` and the Moodle token are written
// directly because the harness owns them; everything a running process holds goes through its route.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { AUTO, BACKEND, DATABASE, PROVIDERS, SITE, call, json, saveSettings } from './api.mjs';
import { BANNER, FAKE_KEYS, FAKE_WSTOKEN, SCRATCH_MARKER, isScratchData } from './env.mjs';
import { seed } from './seed.mjs';
import { snapshot } from './state.mjs';

// Every setting the store knows, as `ENV name → [settings field, type]`, so `hb set` takes the
// names the .env uses and the baseline leaves no field at a value a flow left behind.
export const SETTINGS = {
  DATA_ROOT: ['data_root', 'string'],
  GROQ_API_KEY: ['groq_api_key', 'string'],
  GEMINI_API_KEY: ['gemini_api_key', 'string'],
  GEMINI_MODEL: ['gemini_model', 'string'],
  GDRIVE_ROOT_FOLDER: ['gdrive_root_folder', 'string'],
  DRIVE_ENABLED: ['drive_enabled', 'bool'],
  AUTO_RUN: ['auto_run', 'string'],
  NIGHTLY_RUN: ['nightly_run', 'bool'],
  NIGHTLY_HOUR: ['nightly_hour', 'int'],
};

/** The baseline settings, as ENV name → text. */
export function baselineEnv(paths) {
  return {
    DATA_ROOT: paths.data,
    ...FAKE_KEYS,
    GEMINI_MODEL: 'gemini-2.5-flash',
    GDRIVE_ROOT_FOLDER: 'HuntBugs',
    DRIVE_ENABLED: 'true',
    AUTO_RUN: 'full',
    // Off: a cron firing mid-sweep would attribute its runs to whatever the agent was doing.
    NIGHTLY_RUN: 'false',
    NIGHTLY_HOUR: '3',
  };
}

/** A settings patch from ENV name → text, typed the way the store validates each field. */
export function settingsPatch(env) {
  const patch = {};
  for (const [name, text] of Object.entries(env)) {
    if (!SETTINGS[name]) {
      throw new Error(`unknown setting ${name} (known: ${Object.keys(SETTINGS).join(', ')})`);
    }
    const [field, type] = SETTINGS[name];
    patch[field] =
      type === 'bool'
        ? ['1', 'true', 'yes', 'on'].includes(text.toLowerCase())
        : type === 'int'
          ? Number(text)
          : text;
  }
  return patch;
}

/** The scratch settings store, rewritten whole from the baseline. */
export function writeScratchEnv(paths) {
  const lines = Object.entries(baselineEnv(paths)).map(([name, text]) => `${name}=${text}`);
  fs.writeFileSync(paths.env, `# ${BANNER}\n${lines.join('\n')}\n`);
}

// The Moodle WS token, pre-seeded: the real one arrives through a headed login with MFA by hand,
// which no offline run can produce. Everything downstream of the token is the real code.
export function writeMoodleToken(paths) {
  const tokenPath = path.join(paths.state, 'auth', 'biu-token.json');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(
    tokenPath,
    JSON.stringify({
      wstoken: FAKE_WSTOKEN,
      privatetoken: 'hunt-bugs-private',
      savedAt: new Date().toISOString(),
    }),
  );
}

/** Connect the fake Drive through the backend's consent route, waiting until it reads connected. */
export async function connectDrive() {
  const status = async () => (await call(`${BACKEND}/config/drive/status`)).body;
  if ((await status()).connected) return;
  await call(`${BACKEND}/config/drive/connect`, { method: 'POST' });
  const deadline = Date.now() + 10_000;
  while (!(await status()).connected) {
    if (Date.now() > deadline) throw new Error('the fake Drive consent never connected');
    await sleep(300);
  }
}

/** Put a live stack's settings, tokens, fake modes, file locks and Drive back to the baseline. */
export async function restore(paths) {
  writeScratchEnv(paths);
  // The store is right already; this reaches the processes, which hold what the last save pushed.
  const { data_root: dataRoot, ...rest } = settingsPatch(baselineEnv(paths));
  await json(`${BACKEND}/config`, 'POST', rest);
  await json(`${DATABASE}/config`, 'POST', { data_root: dataRoot });
  // Disconnect first: it is the only thing that clears the auto-downloader's in-memory "expired".
  await call(`${AUTO}/auth/disconnect`, { method: 'POST' });
  writeMoodleToken(paths);
  await json(`${PROVIDERS}/control`, 'POST', { reset: true });
  await json(`${SITE}/control`, 'POST', { reset: true });
  for (const file of ['store.json', 'ops.jsonl']) {
    fs.rmSync(path.join(paths.drive, file), { force: true });
  }
  fs.rmSync(paths.locks, { force: true });
  await connectDrive();
}

// The app has no route that deletes a course or a lecture, so these two are the only direct writes
// to DATA_ROOT — guarded by the marker, and announced on /notify so an open page refreshes.
function wipe(dir) {
  if (!isScratchData(dir)) throw new Error(`${dir} lost its scratch marker — refusing to wipe it`);
  for (const entry of fs.readdirSync(dir)) {
    if (entry !== SCRATCH_MARKER)
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/** Delete one lecture's folder under the database's current root, as a user deleting it by hand. */
export async function removeLecture(course, lecture, kind) {
  const stored = (await call(`${DATABASE}/settings`)).body.data_root;
  if (!stored || !isScratchData(stored)) {
    throw new Error(`data root ${stored || '(unset)'} has no scratch marker — refusing to delete`);
  }
  const root = path.resolve(stored);
  const dir = path.resolve(
    root,
    course,
    ...(kind === 'recitation' ? ['Recitations'] : []),
    lecture,
  );
  if (
    !dir.startsWith(`${root}${path.sep}`) ||
    !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()
  ) {
    throw new Error(`no lecture folder at ${dir}`);
  }
  fs.rmSync(dir, { recursive: true });
  await call(`${DATABASE}/notify`, { method: 'POST' });
  return dir;
}

/** Restore the baseline, wipe both scratch roots and seed the flow courses. */
export async function reseed(paths) {
  await restore(paths);
  wipe(paths.data);
  wipe(paths.dataEmpty);
  const seeded = await seed(paths);
  await call(`${DATABASE}/notify`, { method: 'POST' });
  return seeded;
}

/** Record the current state as the one `hb state` diffs against. */
export async function markSeeded(paths) {
  fs.writeFileSync(paths.seedSnapshot, JSON.stringify(await snapshot(paths), null, 2));
}

const WALLED = ['DATA_ROOT', 'GROQ_API_KEY', 'GEMINI_API_KEY'];

/** Blank the data root and both keys, so the app opens on its first-run screen. */
export async function wall(paths) {
  // The store refuses an empty data root, so the blank goes into the scratch file directly.
  const text = fs.readFileSync(paths.env, 'utf8');
  const kept = text
    .split('\n')
    .filter((line) => !WALLED.some((name) => line.startsWith(`${name}=`)));
  fs.writeFileSync(paths.env, `${kept.join('\n').trimEnd()}\n`);
  // The backend loses its keys too, as on a first boot; the database keeps its root in memory.
  await json(`${BACKEND}/config`, 'POST', { groq_api_key: '', gemini_api_key: '' });
}

/** Put the data root and keys the wall blanked back to the baseline, through the settings routes. */
export async function unwall(paths) {
  const env = baselineEnv(paths);
  await saveSettings(settingsPatch(Object.fromEntries(WALLED.map((name) => [name, env[name]]))));
}
