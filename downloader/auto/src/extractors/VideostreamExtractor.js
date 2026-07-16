import { VideoExtractor } from './VideoExtractor.js';

/** Path ends in .mp4, ignoring query/hash — mirrors background.js's capture filter. */
function endsWithMp4(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

const MP4_WAIT_MS = 20000;

/**
 * BIU Moodle `videostream` module: recorded lectures hosted in-site, each behind
 * its own /mod/videostream/view.php page. Listing is metadata-only (the parser
 * already did the DOM walk); the .mp4 lives on the view.php page and is captured
 * fresh at download time (tokens are short-lived).
 */
export class VideostreamExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'videostream';
  }

  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'videostream';
  }

  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [{ title: activity.title, pageUrl: activity.viewUrl, kind: activity.kind, strategy: 'videostream' }];
  }

  /**
   * DOWNLOAD PHASE: navigate the view.php page and sniff the first .mp4 request —
   * its url + live headers (Referer/Origin/token) are the replay material server.js
   * needs, and they're short-lived so we grab them fresh here.
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture>}
   */
  async _captureVideo(page, rec) {
    // Register the listener BEFORE navigating so an autoplay .mp4 firing during
    // load isn't missed (mirrors background.js's onSendHeaders capture).
    const mp4Request = page.waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS }).catch(() => null);

    await page.goto(rec.pageUrl, { waitUntil: 'load' });

    let request = await mp4Request;
    if (!request) {
      // TODO(unverified): autoplay-vs-click is not confirmed against the real
      // view.php page. Best-effort trigger playback, then wait once more. If the
      // real page needs a specific selector/gesture, refine this here.
      await page
        .evaluate(() => {
          const v = document.querySelector('video');
          if (v) return v.play?.();
          document.querySelector('button[aria-label*="play" i], .play, .vjs-big-play-button')?.click();
        })
        .catch(() => {});
      request = await page.waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS }).catch(() => null);
    }

    if (!request) {
      throw new Error(`No .mp4 request captured on ${rec.pageUrl} (playback may need a manual trigger)`);
    }

    // server.js's headersToObject expects the extension's webRequest shape (an
    // array of {name, value}) instead of Playwright's {name: value} object.
    return {
      title: rec.title,
      url: request.url(),
      headers: Object.entries(request.headers()).map(([name, value]) => ({ name, value })),
      kind: rec.kind,
      strategy: 'videostream',
    };
  }
}
