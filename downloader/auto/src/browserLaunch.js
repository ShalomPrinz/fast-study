import { chromium } from 'playwright';

/**
 * Launch a browser, trying bundled Chromium first. Microsoft login sometimes flags
 * automation on bundled Chromium; if the launch throws, retry with the system
 * Chrome channel (real Chrome is less likely to be blocked).
 * Shared by MicrosoftAuth (headed login) and BrowserSession (persistent headless).
 * @param {{ headless: boolean }} opts
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchBrowser(opts) {
  try {
    return await chromium.launch(opts);
  } catch (err) {
    // Fallback: bundled Chromium failed to launch (or MS blocked it). Retry with
    // the installed Google Chrome. TODO: if MS blocks *bare Chromium* at the login
    // step (launch succeeds but login is rejected) rather than at launch, force
    // `channel: 'chrome'` for the headed path unconditionally instead.
    console.warn(`Chromium launch failed (${err.message}); retrying with channel: 'chrome'…`);
    return chromium.launch({ ...opts, channel: 'chrome' });
  }
}
