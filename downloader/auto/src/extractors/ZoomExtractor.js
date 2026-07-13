import { VideoExtractor } from './VideoExtractor.js';

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
   * One Recording per share link. `passcode` rides on the Recording (encoded into
   * the opaque ref at the HTTP boundary) and drives the passcode gate at download.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        pageUrl: activity.pageUrl,
        passcode: activity.passcode,
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
    await this.#submitPasscode(page, rec.passcode);

    let request = await firstWait;
    if (!request) {
      // TODO(unverified): the zoom player's autoplay-vs-click behaviour and its
      // play-button selector are not confirmed against the live share page (no
      // access in this environment). Best-effort trigger, then wait once more.
      await this.#triggerPlay(page);
      request = await page
        .waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS })
        .catch(() => null);
    }
    if (!request) {
      throw new Error(`No .mp4 request captured on zoom share ${rec.pageUrl} (passcode/player may need a manual trigger)`);
    }
    seen.add(mp4Key(request.url()));
    const captures = [this.#toCapture(request, rec)];

    // Attempt the second recording (before/after the break). Only kept if it's a
    // DISTINCT .mp4 — otherwise we ship a single file named `Lecture N`.
    const second = await this.#captureSecond(page, seen);
    if (second) captures.push(this.#toCapture(second, rec));
    return captures;
  }

  /**
   * Fill + submit the passcode gate if present. No-op when the page shows the
   * player directly (already authorized or link without a passcode).
   * @param {import('playwright').Page} page
   * @param {string|undefined} passcode
   */
  async #submitPasscode(page, passcode) {
    if (!passcode) return;
    // TODO(unverified): the real zoom passcode field/submit selectors can't be
    // confirmed here. These cover the common cases (password input + submit
    // button); refine against the live gate if capture fails.
    const field = await page
      .waitForSelector('input#passcode, input[name="passcode"], input[type="password"]', { timeout: 5000 })
      .catch(() => null);
    if (!field) return;
    await field.fill(passcode).catch(() => {});
    await page
      .click('button[type="submit"], #passcode_btn, .passcode-btn, button:has-text("Submit")')
      .catch(() => {});
    await page.waitForLoadState('load').catch(() => {});
  }

  /**
   * Try to advance to the second recording and sniff a DISTINCT .mp4.
   * @param {import('playwright').Page} page
   * @param {Set<string>} seen  keys of already-captured .mp4s
   * @returns {Promise<import('playwright').Request|null>}
   */
  async #captureSecond(page, seen) {
    const wait = page
      .waitForRequest((req) => endsWithMp4(req.url()) && !seen.has(mp4Key(req.url())), { timeout: SECOND_MP4_WAIT_MS })
      .catch(() => null);
    // TODO(unverified): zoom auto-advances at the end of part 1, or exposes a
    // "next recording" control in the player — neither is confirmable here. Click
    // a likely next-control; if the page auto-advances instead, the wait catches it.
    await page
      .evaluate(() => {
        const next = document.querySelector(
          '[aria-label*="next" i], [title*="next" i], .next-recording, .vjs-next-button',
        );
        next?.click();
      })
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
        document.querySelector('button[aria-label*="play" i], .play, .vjs-big-play-button, .playback-btn')?.click();
      })
      .catch(() => {});
  }

  /** Map a captured request to server.js's expected [{name,value}] header shape. */
  #toCapture(request, rec) {
    return {
      title: rec.title,
      url: request.url(),
      headers: Object.entries(request.headers()).map(([name, value]) => ({ name, value })),
      kind: rec.kind,
      strategy: 'zoom',
    };
  }
}
