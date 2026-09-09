import { chromium } from 'playwright';

// The Chromium-family browsers this service can drive, most preferred first. Both are proven
// against the zoom recording player; a packaged install ships no browser of its own, so this
// chain IS the prerequisite — on Windows it is never empty, since Edge is preinstalled.
const CHANNELS = [
  { channel: 'chrome', browser: 'Google Chrome' },
  { channel: 'msedge', browser: 'Microsoft Edge' },
];

// The resolved channel, cached for the life of the process: a channel that resolved a minute ago
// resolves again, and each probe is a real browser launch (~500ms for one that is installed).
// Only a SUCCESS is cached — a negative answer stays re-checkable, because installing a browser
// and asking again is the intended fix. `pending` dedupes probes racing on startup.
let resolved = null;
let pending = null;

/**
 * Is this channel installed? Playwright exposes no public API that resolves a channel's
 * executable path — `chromium.executablePath()` takes no channel argument and returns the
 * BUNDLED Chromium path even for a channel that does not exist — but it resolves the channel
 * before spawning anything, so a missing browser rejects in milliseconds naming the path it
 * looked at, and a present one costs one headless launch.
 */
async function probe(channel) {
  const browser = await chromium.launch({ channel, headless: true });
  await browser.close();
}

/**
 * The first installed browser in the chain, `{ channel, browser }`, cached per process.
 * Throws when no channel resolves; that error names every path tried and is the one worth
 * surfacing — a bundled-Chromium failure after it only means nobody ran `playwright install`.
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
  throw new Error(`No Chromium browser found. ${failures.join(' | ')}`);
}

// Playwright's launch errors are multi-paragraph install advice; the first line carries the
// channel and the path it looked at, which is all the settings screen has room for.
function firstLine(err) {
  return String(err?.message ?? err)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
}
