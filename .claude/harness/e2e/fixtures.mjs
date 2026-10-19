// The shared `test` for every e2e spec: @playwright/test with the harness's own chromium and offline
// flags, plus the levers specs pull on the live stack named by HARNESS_DIR.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE, PROVIDERS, SITE, bindPorts, call, json } from '../lib/api.mjs';
import { markSeeded, reseed as reseedStack } from '../lib/baseline.mjs';
import { OFFLINE_ARGS, installedChromium } from '../lib/browser.mjs';
import { harnessPaths, readPorts } from '../lib/env.mjs';
import { readLocks } from '../lib/state.mjs';

function resolveHarness() {
  const root = process.env.HARNESS_DIR;
  if (!root) throw new Error('HARNESS_DIR is unset — point it at a live `setup.mjs --harness DIR`');
  const paths = harnessPaths(path.resolve(root));
  if (!fs.existsSync(paths.ports)) throw new Error(`no ${paths.ports} — is that stack up?`);
  bindPorts(paths);
  return paths;
}

/** This stack's paths; importing this module binds the lib/ URLs to its ports. */
export const harness = resolveHarness();

/** One of this stack's URLs by `hb url` name: the frontend by localhost, the rest by address. */
export function url(name) {
  const port = readPorts(harness)[name];
  if (!port) throw new Error(`no port "${name}" in ${harness.ports}`);
  return `http://${name === 'frontend' ? 'localhost' : '127.0.0.1'}:${port}`;
}

/** POST a body to the fake providers' /control, e.g. `{ gemini: { mode: '429', times: 1 } }`. */
export const providers = async (body) => (await json(`${PROVIDERS}/control`, 'POST', body)).body;

/** POST a body to the fake lecture site's /control, e.g. `{ mode: 'missing_function' }`. */
export const site = async (body) => (await json(`${SITE}/control`, 'POST', body)).body;

// The same locks.json `hb lock` writes; the database reads it on every write.
function writeLocks(globs) {
  if (globs.length) fs.writeFileSync(harness.locks, JSON.stringify(globs));
  else fs.rmSync(harness.locks, { force: true });
}

/** Fail the database's writes to files matching these globs ('<course>/<lecture>/<file>') with 423. */
export function lock(...globs) {
  writeLocks([...new Set([...readLocks(harness), ...globs])]);
}

/** Drop these locks, or every lock when none is named. */
export function unlock(...globs) {
  writeLocks(globs.length ? readLocks(harness).filter((g) => !globs.includes(g)) : []);
}

/** Both fakes back to their defaults and every lock dropped: `test.afterEach(reset)`. */
export async function reset() {
  await providers({ reset: true });
  await site({ reset: true });
  unlock();
}

/** Put the whole stack back on its seed, as `hb reseed` does: `test.beforeEach(reseed)` for a spec that
 *  changes seeded files, so a rerun on the same stack starts where a fresh one would. */
export async function reseed() {
  await reseedStack(harness);
  await markSeeded(harness);
}

/** A lecture view's pipeline row for `name`; its `data-status` is what the specs wait on. */
export const step = (view, name) =>
  view.locator(`[data-testid="step-status"][data-step="${name}"]`);

/** Wait for each step in order to settle, then require `done`, so a failed step fails at once. */
export async function expectStepsDone(view, names, timeout = 45_000) {
  for (const name of names) {
    await expect(step(view, name)).toHaveAttribute('data-status', /^(done|failed|quota)$/, {
      timeout,
    });
    await expect(step(view, name)).toHaveAttribute('data-status', 'done', { timeout: 1_000 });
  }
}

/** One lecture's `/tree` entry (`files`, `materials`), or undefined when the database lists none. */
export async function treeLecture(course, lecture, kind = 'lecture') {
  const { body: tree } = await call(`${DATABASE}/tree`);
  const entry = tree.find((c) => c.name === course);
  return entry?.[kind === 'recitation' ? 'recitations' : 'lectures'].find(
    (l) => l.name === lecture,
  );
}

/** The fake Drive's file id at a name chain from the root, e.g. `('Harness', 'hb-pipeline', 'x.pdf')`,
 *  or null; the chain is the folders upload_to_drive created, walked by parent. */
export function driveFile(...names) {
  let files = {};
  try {
    ({ files } = JSON.parse(fs.readFileSync(path.join(harness.drive, 'store.json'), 'utf8')));
  } catch {
    return null;
  }
  let parent;
  for (const name of names) {
    const hit = Object.entries(files).find(
      ([, row]) => row.name === name && (parent ? row.parent === parent : !(row.parent in files)),
    );
    if (!hit) return null;
    parent = hit[0];
  }
  return parent;
}

/** Drop a local file on `target` the way a user drags one from the file manager: the page builds a
 *  real `File` in a `DataTransfer`, since Playwright cannot drag from outside the browser. */
export async function dropFile(target, filePath, type) {
  const bytes = fs.readFileSync(filePath).toString('base64');
  const transfer = await target.page().evaluateHandle(
    ({ bytes, name, type }) => {
      const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
      const transfer = new globalThis.DataTransfer(); // runs in the page, where it exists
      transfer.items.add(new File([data], name, { type }));
      return transfer;
    },
    { bytes, name: path.basename(filePath), type },
  );
  for (const event of ['dragenter', 'dragover', 'drop'])
    await target.dispatchEvent(event, { dataTransfer: transfer });
}

export const test = base.extend({
  browser: [
    async ({ playwright }, use) => {
      const browser = await playwright.chromium.launch({
        executablePath: installedChromium(),
        args: OFFLINE_ARGS,
      });
      await use(browser);
      await browser.close();
    },
    { scope: 'worker' },
  ],
});

export { expect };
