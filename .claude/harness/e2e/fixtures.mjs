// The shared `test` for every e2e spec: @playwright/test with the harness's own chromium and offline
// flags, plus the levers specs pull on the live stack named by HARNESS_DIR.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS, SITE, bindPorts, json } from '../lib/api.mjs';
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
