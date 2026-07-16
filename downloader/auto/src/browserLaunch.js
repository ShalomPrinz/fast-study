import { chromium } from 'playwright';

/**
 * Launch a browser, trying bundled Chromium first. Microsoft login sometimes flags
 * automation on bundled Chromium; if the launch throws, retry with the system
 * Chrome channel (real Chrome is less likely to be blocked).
 * This is the PLAIN launcher: no stealth, no forced channel — used by course
 * listing, videostream capture, and the headed Microsoft login. The zoom path has
 * its own launcher (chrome + stealth + Xvfb) in zoomBrowser.js.
 * @param {{ headless: boolean }} opts
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchBrowser(opts) {
  return await chromium.launch(opts);
}
