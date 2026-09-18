import { chromium } from 'playwright';
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
