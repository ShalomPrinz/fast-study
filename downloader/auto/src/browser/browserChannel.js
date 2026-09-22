import { chromium } from 'playwright';
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

// Is this channel installed? A real headless launch: Playwright has no API that resolves a
// channel's executable, and a missing one rejects in milliseconds naming the path it tried.
async function probe(channel) {
  const browser = await chromium.launch({ channel, headless: true });
  await browser.close();
}

/**
 * The first installed browser in the chain, `{ channel, browser }`. Throws naming every path
 * tried — the error worth surfacing over any bundled-Chromium failure after it.
 * @returns {Promise<{ channel: string, browser: string }>}
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

async function probeChain() {
  const failures = [];
  for (const candidate of CHANNELS) {
    try {
      await probe(candidate.channel);
      resolved = candidate;
      return candidate;
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
