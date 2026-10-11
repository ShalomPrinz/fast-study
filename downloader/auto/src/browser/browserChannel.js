import { CodedError } from '../lib/errors.js';

// Most preferred first; both proven against the zoom player. A packaged install ships no browser,
// so this chain IS the prerequisite — never empty on Windows, where Edge is preinstalled.
const CHANNELS = [
  { channel: 'chrome', browser: 'Google Chrome' },
  { channel: 'msedge', browser: 'Microsoft Edge' },
];

// Only a SUCCESS is cached (per process) — a negative stays re-checkable after the user installs
// a browser. `pending` dedupes probes racing on startup. See docs/SESSIONS.md.
let resolved = null;
let pending = null;
const deps = { chromium: async () => (await import('playwright')).chromium };

/** Tests swap Playwright's chromium and start from an empty cache; → a function restoring both. */
export function configureBrowserChannel(overrides) {
  const prev = { ...deps };
  Object.assign(deps, overrides);
  resolved = null;
  return () => {
    Object.assign(deps, prev);
    resolved = null;
  };
}

// Is this channel installed? A real headless launch: Playwright has no API that resolves a
// channel's executable, and a missing one rejects in milliseconds naming the path it tried.
// → the channel's UA as a headed launch sends it, or null when the page could not report it.
async function probe(channel) {
  const chromium = await deps.chromium();
  const browser = await chromium.launch({ channel, headless: true });
  try {
    const page = await browser.newPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    return ua.replace('HeadlessChrome', 'Chrome');
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * The first installed browser in the chain, `{ channel, browser, userAgent }` — `userAgent` null
 * when the probe's page could not read it. Throws naming every path tried — the error worth
 * surfacing over any bundled-Chromium failure after it.
 * @returns {Promise<{ channel: string, browser: string, userAgent: string|null }>}
 */
export function resolveBrowserChannel() {
  if (resolved) return Promise.resolve(resolved);
  if (!pending) {
    pending = probeChain().finally(() => {
      pending = null;
    });
  }
  return pending;
}

/**
 * The resolved channel's UA, re-probing that channel while it is unknown: a null UA from one failed
 * page read stays out of the cache, so it never disables the challenge window until a restart.
 * @returns {Promise<string|null>}
 */
export async function resolveUserAgent() {
  const r = await resolveBrowserChannel();
  if (r.userAgent) return r.userAgent;
  const userAgent = await probe(r.channel);
  if (userAgent && resolved === r) resolved = { ...r, userAgent };
  return userAgent;
}

async function probeChain() {
  const failures = [];
  for (const candidate of CHANNELS) {
    try {
      const userAgent = await probe(candidate.channel);
      resolved = { ...candidate, userAgent };
      return resolved;
    } catch (err) {
      failures.push(`${candidate.channel}: ${firstLine(err)}`);
    }
  }
  const detail = failures.join(' | ');
  throw new CodedError('browser_missing', { detail }, `No Chromium browser found. ${detail}`);
}

// Playwright's launch errors are multi-paragraph install advice; the first line carries the
// channel and the path it looked at, which is all the settings screen has room for.
function firstLine(err) {
  return String(err?.message ?? err)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
}
