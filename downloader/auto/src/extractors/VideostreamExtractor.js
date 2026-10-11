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

/** A landing on Moodle's login page: the browser holds no live session for the site. */
export function onLoginPage(url) {
  try {
    return new URL(url).pathname.includes('/login/');
  } catch {
    return false;
  }
}

/**
 * A page Moodle rendered for someone other than the token's user: anonymous (`M.cfg.userId` 0) or
 * guest. `pageUser` is null when unread, which says nothing.
 */
export function notTheUser(pageUser, userid) {
  if (pageUser == null) return false;
  return pageUser === 0 || (userid != null && pageUser !== Number(userid));
}

// The user the page was rendered for: core puts `$USER->id` in every page's M.cfg, theme or not.
async function renderedUserId(page) {
  const id = await page.evaluate(() => globalThis.M?.cfg?.userId).catch(() => null);
  return Number.isInteger(id) ? id : null;
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

  /** The Moodle browser (the challenge window), where the autologin left its session. */
  get browserProfile() {
    return 'moodle';
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
   * @param {{ userid?: number }} [opts]  the stored token's user, whom the page must be rendered for
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture>}
   */
  async _captureVideo(page, rec, opts) {
    // The view page is on the Moodle site; the gate goes first, before the listener is armed.
    await enterMoodle(rec.pageUrl);
    // Register the listener BEFORE navigating so an autoplay .mp4 firing during
    // load isn't missed (mirrors background.js's onSendHeaders capture).
    const mp4Request = page
      .waitForRequest((req) => endsWithMp4(req.url()), { timeout: MP4_WAIT_MS })
      .catch(() => null);

    await page.goto(rec.pageUrl, { waitUntil: 'load' });
    // The login, or a guest page (BIU logs anonymous visitors in as guest): the route autologins
    // and retries once; a second one reaches the client.
    if (onLoginPage(page.url()) || notTheUser(await renderedUserId(page), opts?.userid)) {
      throw new CodedError(
        'videostream_login_required',
        { url: rec.pageUrl },
        `${rec.pageUrl} landed logged out (the login or a guest page)`,
      );
    }

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
