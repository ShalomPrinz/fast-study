import { VideoExtractor } from './VideoExtractor.js';
import { ZOOM_PASSWORD } from '../config.js';

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

const MP4_WAIT_MS = 20000;
// The second recording auto-advances only at the END of part 1, which could be a
// long lecture. We don't wait a full video length here — best-effort: if a second
// .mp4 doesn't surface promptly (auto-advance or a "next" control), we ship one file.
const SECOND_MP4_WAIT_MS = 15000;

/**
 * Zoom cloud recording shared via a `zoom.us/rec/share/…` link (discovered in a
 * course section summary by `parseZoomSection`s, not as an `li.activity` card).
 * The share page is passcode-gated and serves a direct `.mp4`, captured the same
 * way `videostream` is. A single share link can hold TWO recordings (before/after
 * the break); when a distinct second `.mp4` is captured the caller splits the name
 * into `Lecture N.1` / `Lecture N.2`.
 */
export class ZoomExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
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
   * One Recording per share link. The passcode is NOT carried here — every BIU
   * share uses the single hardcoded `ZOOM_PASSWORD` (see config.js), applied at
   * the passcode gate during download.
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
   * DOWNLOAD PHASE: open the share page, clear the passcode gate, and sniff the
   * recording `.mp4`(s). Returns 1-or-2 captures — unlike other extractors which
   * return a single VideoCapture — because one share link can hold two recordings
   * (the caller (core.js / index.js) splits the name only when 2 are captured).
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture[]>}
   */
  async captureVideo(page, rec) {
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

    // A share link can hold two recordings (before/after the break). The player's
    // clip control reads "Total N Recordings" only when N > 1 — use that as the
    // authoritative signal instead of guessing, then advance to sniff the second.
    if (await this.#hasMultipleClips(page)) {
      const second = await this.#captureSecond(page, seen);
      if (second) captures.push(await this.#toCapture(second, rec));
    }
    return captures;
  }

  /**
   * Fill the passcode gate with the hardcoded ZOOM_PASSWORD and click "Watch
   * Recording". No-op when the page shows the player directly (already authorized
   * or a link without a gate). Selectors match the live zoom share form:
   *   <input id="passcode" type="password"> + <button id="passcode_btn">Watch Recording</button>
   * @param {import('playwright').Page} page
   */
  async #submitPasscode(page) {
    const field = await page
      .waitForSelector('input#passcode, input[type="password"]', { timeout: 5000 })
      .catch(() => null);
    if (!field) return;
    await field.fill(ZOOM_PASSWORD).catch(() => {});
    // The share form's action is `javascript:;` (Vue SPA) — clicking #passcode_btn
    // swaps in the player in place, so there's no navigation to wait on; the .mp4
    // request wait in captureVideo is what confirms the gate cleared.
    await page
      .click('#passcode_btn, button:has-text("Watch Recording")')
      .catch(() => {});
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
   * Map a captured request to server.js's expected [{name,value}] header shape.
   * MUST use allHeaders() (async), not headers(): Playwright's sync headers()
   * omits security-related headers — crucially `Cookie` — so a curl replay of the
   * token-gated zoom .mp4 lands unauthenticated.
   * Before: headers()     -> no Cookie  -> curl (22) HTTP 403
   * After:  allHeaders()  -> Cookie set -> curl streams the mp4
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
