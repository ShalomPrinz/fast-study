import { chromium } from 'playwright';

// Launch args shared by EVERY browser the auto-downloader spawns (plain + zoom).
// --mute-audio: lecture and zoom recordings autoplay on load, and nobody is watching these
// windows — unmuted they would play out of the user's speakers for the whole capture.
export const COMMON_LAUNCH_ARGS = ['--mute-audio'];

/**
 * Launch a browser, trying system Chrome first and falling back to bundled Chromium: an
 * installed build ships no bundled Chromium at all, and the headed token grab's Entra SSO
 * sometimes flags automation on it anyway. This is the PLAIN launcher: no stealth — used by
 * course listing, videostream capture, and the headed token grab. The zoom path has its own
 * launcher (chrome + stealth) in zoomBrowser.js.
 * @param {{ headless: boolean }} opts
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchBrowser(opts) {
  const args = [...COMMON_LAUNCH_ARGS, ...(opts.args ?? [])];
  try {
    return await chromium.launch({ ...opts, channel: 'chrome', args });
  } catch (err) {
    try {
      return await chromium.launch({ ...opts, args });
    } catch {
      // Surface the Chrome error: Chrome is the real prerequisite, and the bundled-Chromium
      // failure is just "not installed" on any machine that didn't run `playwright install`.
      throw err;
    }
  }
}
