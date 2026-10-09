import { resolveBrowserChannel } from './browserChannel.js';

// Shared by EVERY browser this service spawns. --mute-audio: recordings autoplay, and nobody is
// watching — unmuted they would play out of the user's speakers for the whole capture.
export const COMMON_LAUNCH_ARGS = ['--mute-audio'];

/**
 * The PLAIN launcher (no stealth): videostream capture and the headed token grab. The user's
 * Chrome or Edge, falling back to bundled Chromium. The zoom launcher is zoomBrowser.js.
 * @param {{ headless: boolean }} opts
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchBrowser(opts) {
  const args = [...COMMON_LAUNCH_ARGS, ...(opts.args ?? [])];
  const { chromium } = await import('playwright');
  let channelErr;
  try {
    const { channel } = await resolveBrowserChannel();
    return await chromium.launch({ ...opts, channel, args });
  } catch (err) {
    channelErr = err;
  }
  try {
    return await chromium.launch({ ...opts, args });
  } catch {
    // Surface the channel error: an installed browser is the real prerequisite, and a bundled
    // failure only means nobody ran `playwright install`.
    throw channelErr;
  }
}

/**
 * launchBrowser's channel chain, as a persistent context on the profile at `dir` — the Moodle
 * challenge window, whose bot-manager clearance lives in that profile (docs/MOODLE.md).
 * @param {string} dir
 * @param {{ headless: boolean, args?: string[], viewport?: null }} opts
 * @returns {Promise<import('playwright').BrowserContext>}
 */
export async function launchPersistentBrowser(dir, opts) {
  const args = [...COMMON_LAUNCH_ARGS, ...(opts.args ?? [])];
  const { chromium } = await import('playwright');
  let channelErr;
  try {
    const { channel } = await resolveBrowserChannel();
    return await chromium.launchPersistentContext(dir, { ...opts, channel, args });
  } catch (err) {
    channelErr = err;
  }
  try {
    return await chromium.launchPersistentContext(dir, { ...opts, args });
  } catch {
    throw channelErr;
  }
}
