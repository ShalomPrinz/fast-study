// import { chromium } from 'playwright';  // TODO: enable once enumeration is implemented
import { CourseSource } from './CourseSource.js';

/** Path ends in .mp4, ignoring query/hash — mirrors background.js's capture filter. */
function endsWithMp4(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

/**
 * BIU course source: navigate the course URL in a headless browser and sniff
 * the network for .mp4 requests (mirrors the extension's webRequest capture in
 * downloader/background.js), capturing each video's URL + request headers.
 */
export class BiuCourseSource extends CourseSource {
  /**
   * @param {import('../auth/AuthProvider.js').StorageState} authState
   * @param {string} courseUrl
   * @returns {Promise<import('./CourseSource.js').VideoCapture[]>}
   */
  async listVideos(authState, courseUrl) {
    /** @type {Map<string, import('./CourseSource.js').VideoCapture>} */
    const captures = new Map(); // keyed by url for dedupe (like background.js's ring)

    // TODO: launch headless chromium and build a context from authState:
    //   const browser = await chromium.launch({ headless: true });
    //   const context = await browser.newContext({ storageState: authState });
    //
    // Register the sniffer BEFORE navigating so no early .mp4 request is missed:
    //   context.on('request', (req) => {
    //     if (endsWithMp4(req.url()) && !captures.has(req.url())) {
    //       captures.set(req.url(), { title: currentTitle, url: req.url(), headers: req.headers() });
    //     }
    //   });
    //
    //   const page = await context.newPage();
    //   await page.goto(courseUrl, { waitUntil: 'domcontentloaded' });
    //
    // TODO(site-specific enumeration — plan §9.3/§9.4): find the lecture list,
    // and for each lecture open/click it to trigger playback so its .mp4 request
    // fires; take `title` from the lecture link/heading text. Requires inspecting
    // the live BIU pages in devtools (selectors + how playback is triggered).
    //
    //   await browser.close();

    void endsWithMp4; // referenced by the TODO sniffer above; keeps the helper live
    void courseUrl;
    void authState;

    return [...captures.values()];
  }
}
