import { chromium } from 'playwright';

// Launch args shared by EVERY browser the auto-downloader spawns (plain + zoom).
// --mute-audio: these browsers run headless / on a virtual Xvfb display with no audio
// sink, yet lecture and zoom recordings autoplay on load. Muting keeps them from
// pushing audio into a nonexistent output (and keeps the dev/CI machine silent).
export const COMMON_LAUNCH_ARGS = ['--mute-audio'];

/**
 * Launch a browser, trying bundled Chromium first. The headed token grab's Entra
 * SSO sometimes flags automation on bundled Chromium; if the launch throws, retry
 * with the system Chrome channel (real Chrome is less likely to be blocked).
 * This is the PLAIN launcher: no stealth, no forced channel — used by course
 * listing, videostream capture, and the headed token grab. The zoom path has
 * its own launcher (chrome + stealth + Xvfb) in zoomBrowser.js.
 * @param {{ headless: boolean }} opts
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchBrowser(opts) {
  const args = [...COMMON_LAUNCH_ARGS, ...(opts.args ?? [])];
  try {
    return await chromium.launch({ ...opts, args });
  } catch (err) {
    try {
      return await chromium.launch({ ...opts, channel: 'chrome', args });
    } catch {
      // Surface the original bundled-Chromium error, not the fallback's.
      throw err;
    }
  }
}
