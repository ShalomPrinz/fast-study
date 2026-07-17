import { VideoExtractor } from './VideoExtractor.js';
import { ZOOM_PASSWORD } from '../lib/config.js';

/** Path ends in .mp4, ignoring query/hash — mirrors background.js's capture filter. */
function endsWithMp4(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

/** Identity of an mp4 stream, ignoring its (per-request, token-bearing) query. */
function mp4Key(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const MP4_WAIT_MS = 30000;
// Best-effort wait for the second clip's .mp4 (not a full video length); ship one file if none.
const SECOND_MP4_WAIT_MS = 15000;

/**
 * Zoom cloud recording from a passcode-gated `zoom.us/rec/share/…` link (found in a
 * section summary, not an `li.activity` card). Serves a direct `.mp4`, captured like
 * `videostream`; one share can hold two recordings. See docs/ZOOM.md.
 */
export class ZoomExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'zoom';
  }

  /** The zoom recording player rejects headless/SwiftShader Chrome — needs the heavyweight profile. */
  get browserProfile() {
    return 'zoom';
  }

  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'zoom';
  }

  /**
   * One Recording per share link; the passcode is NOT carried (single hardcoded
   * ZOOM_PASSWORD, applied at the gate — see config.js / docs/ZOOM.md).
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        pageUrl: activity.pageUrl,
        kind: activity.kind,
        strategy: 'zoom',
      },
    ];
  }

  /**
   * DOWNLOAD PHASE: open the share, clear the passcode gate, sniff the `.mp4`(s).
   * Returns 1-or-2 captures (a share can hold two recordings); core.js splits the name.
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture[]>}
   */
  async _captureVideo(page, rec) {
    // Register the listener BEFORE navigating so an autoplay .mp4 firing during
    // load isn't missed (mirrors VideostreamExtractor / background.js).
    const seen = new Set();
    const firstWait = page
      .waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS })
      .catch(() => null);

    await page.goto(rec.pageUrl, { waitUntil: 'load' });
    await this.#submitPasscode(page);

    let request = await firstWait;
    if (!request) {
      // The player may not autoplay after the gate clears — nudge playback, then
      // wait once more for the .mp4 request.
      await this.#triggerPlay(page);
      request = await page
        .waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS })
        .catch(() => null);
    }
    if (!request) {
      throw new Error(`No .mp4 request captured on zoom share ${rec.pageUrl} (passcode/player may need a manual trigger)`);
    }
    seen.add(mp4Key(request.url()));
    const captures = [await this.#toCapture(request, rec)];

    // A share can hold two recordings; "Total N Recordings" (N>1) is the authoritative
    // signal to advance and sniff the second (docs/ZOOM.md).
    if (await this.#hasMultipleClips(page)) {
      const second = await this.#captureSecond(page, seen);
      if (second) captures.push(await this.#toCapture(second, rec));
    }
    return captures;
  }

  /**
   * Fill the passcode gate (`input#passcode` + `#passcode_btn` "Watch Recording") with
   * ZOOM_PASSWORD. No-op when the player shows directly (already authorized / no gate).
   * @param {import('playwright').Page} page
   */
  async #submitPasscode(page) {
    const field = await page
      .waitForSelector('input#passcode, input[type="password"]', { timeout: 5000 })
      .catch(() => null);
    if (!field) return;
    // The share form is a Vue SPA whose passcode binding lands a beat after the input
    // appears, so a fill fired too early is dropped and the gate never clears. Re-fill +
    // click each retry until #passcode detaches. See docs/ZOOM.md.
    for (let i = 0; i < 5; i++) {
      await page.fill('input#passcode, input[type="password"]', ZOOM_PASSWORD).catch(() => {});
      await page
        .click('#passcode_btn, button:has-text("Watch Recording")')
        .catch(() => {});
      const cleared = await page
        .waitForSelector('input#passcode', { state: 'detached', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (cleared) {
        console.log(`[zoom] passcode gate cleared on attempt ${i + 1}`);
        return;
      }
    }
    // Distinguishes a passcode-gate failure from a later player/.mp4 failure in the log.
    console.warn('[zoom] passcode gate did NOT clear after 5 attempts');
  }

  /**
   * Does the player expose more than one clip? The `.vjs-multiple-clip-control`
   * strip renders "Total N Recordings" only for multi-clip shares.
   * @param {import('playwright').Page} page
   * @returns {Promise<boolean>}
   */
  async #hasMultipleClips(page) {
    const el = await page
      .waitForSelector('.vjs-multiple-clip-control', { timeout: 5000 })
      .catch(() => null);
    if (!el) return false;
    const text = (await el.textContent().catch(() => '')) || '';
    const m = text.match(/Total\s+(\d+)\s+Recordings/i);
    return m ? Number(m[1]) > 1 : false;
  }

  /**
   * Advance to the next clip (the "Go Forward to next clip" control) and sniff a
   * DISTINCT .mp4. Only kept when it's genuinely a different stream.
   * @param {import('playwright').Page} page
   * @param {Set<string>} seen  keys of already-captured .mp4s
   * @returns {Promise<import('playwright').Request|null>}
   */
  async #captureSecond(page, seen) {
    const wait = page
      .waitForRequest((req) => endsWithMp4(req.url()) && !seen.has(mp4Key(req.url())), { timeout: SECOND_MP4_WAIT_MS })
      .catch(() => null);
    await page
      .click('.vjs-multiple-clip-control-button.button-next button')
      .catch(() => {});
    const request = await wait;
    if (request) seen.add(mp4Key(request.url()));
    return request;
  }

  /** Best-effort start playback so a gated .mp4 request fires. */
  async #triggerPlay(page) {
    await page
      .evaluate(() => {
        const v = document.querySelector('video');
        if (v) return v.play?.();
        document.querySelector('.vjs-big-play-button, button[aria-label*="play" i]')?.click();
      })
      .catch(() => {});
  }

  /**
   * Map a captured request to server/'s [{name,value}] header shape. MUST use
   * allHeaders() (async), not headers(): the sync one omits `Cookie`, so the curl
   * replay of the token-gated .mp4 would land unauthenticated (403).
   */
  async #toCapture(request, rec) {
    const headers = await request.allHeaders();
    return {
      title: rec.title,
      url: request.url(),
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      kind: rec.kind,
      strategy: 'zoom',
    };
  }
}
