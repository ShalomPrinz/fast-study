import { VideoExtractor } from './VideoExtractor.js';
import { CodedError } from '../lib/errors.js';
import { enterMoodle } from '../moodle/gate.js';

/** Path ends in .mp4, ignoring query/hash — mirrors background.js's capture filter. */
function endsWithMp4(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

const MP4_WAIT_MS = 20000;
// The player's own answer names the file's size; no extra request is spent learning it.
const SIZE_WAIT_MS = 5000;

// The .mp4's full size from the player's response (Content-Range total, or a whole Content-Length),
// or null when it did not arrive in time or did not say.
async function sizeOf(request) {
  let timer;
  const timeout = new Promise((r) => (timer = setTimeout(() => r(null), SIZE_WAIT_MS)));
  const response = await Promise.race([request.response().catch(() => null), timeout]);
  clearTimeout(timer);
  if (!response) return null;
  const headers = response.headers();
  const range = /\/(\d+)\s*$/.exec(headers['content-range'] ?? '');
  if (range) return Number(range[1]);
  return response.status() === 200 && headers['content-length']
    ? Number(headers['content-length'])
    : null;
}

/**
 * Moodle `videostream` plugin module: an in-site recorded lecture behind its own view.php page.
 * Listing is metadata-only; the .mp4 is sniffed fresh at download time (tokens are short-lived).
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

  // The module page, the autologin and the .mp4 sniff all run on Moodle.
  reachesMoodle() {
    return true;
  }

  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        pageUrl: activity.viewUrl,
        kind: activity.kind,
        strategy: 'videostream',
        section: activity.sectionName,
      },
    ];
  }

  /**
   * DOWNLOAD PHASE: navigate the view.php page and sniff the first .mp4 request — its url +
   * live headers (Referer/Origin/token) are what server/'s curl replays.
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture>}
   */
  async _captureVideo(page, rec) {
    // The view page is on the Moodle site; the gate goes first, before the listener is armed.
    await enterMoodle(rec.pageUrl);
    // Register the listener BEFORE navigating so an autoplay .mp4 firing during
    // load isn't missed (mirrors background.js's onSendHeaders capture).
    const mp4Request = page
      .waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS })
      .catch(() => null);

    await page.goto(rec.pageUrl, { waitUntil: 'load' });

    let request = await mp4Request;
    if (!request) {
      // Player may not autoplay — nudge playback, then wait once more for the .mp4.
      await page
        .evaluate(() => {
          const v = document.querySelector('video');
          if (v) return v.play?.();
          document
            .querySelector('button[aria-label*="play" i], .play, .vjs-big-play-button')
            ?.click();
        })
        .catch(() => {});
      request = await page
        .waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS })
        .catch(() => null);
    }

    if (!request) {
      throw new CodedError(
        'videostream_no_media_request',
        { url: rec.pageUrl },
        `No .mp4 request captured on ${rec.pageUrl} (playback may need a manual trigger)`,
      );
    }

    // server/ expects the extension's webRequest shape ([{name,value}]), not Playwright's object.
    return {
      title: rec.title,
      url: request.url(),
      headers: Object.entries(request.headers()).map(([name, value]) => ({ name, value })),
      size: await sizeOf(request),
      kind: rec.kind,
      strategy: 'videostream',
    };
  }
}
