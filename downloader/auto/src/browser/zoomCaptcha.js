// A captcha on a zoom share: on Windows the hidden zoom window comes on screen for the user to solve
// it, mirroring the Moodle challenge window; elsewhere (Xvfb, no screen to show) it is refused.
// See docs/ZOOM.md § Captcha.
import { EventEmitter } from 'node:events';
import { CodedError } from '../lib/errors.js';

const OFF_SCREEN = { left: -32000, top: -32000 };
const ON_SCREEN = { left: 80, top: 80 };

// Playwright checks only a selector list's first DOM match, so each alternative carries `:visible`:
// a hidden earlier match (reCAPTCHA's idle bframe) never masks a visible one.
const visible = (...alts) => alts.map((a) => `${a}:visible`).join(', ');

// The player renders only past the passcode gate and any captcha; zoom shows the gate either way.
const PLAYER = visible('video', '.video-js');
const GATE = visible('input#passcode', 'input[type="password"]');
// A reCAPTCHA / hCaptcha / Turnstile frame; reCAPTCHA v3's always-present invisible badge is not one.
const CAPTCHA = visible(
  'iframe[src*="recaptcha"]:not([src*="size=invisible"])',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
);

// detectMs: how long the player gets to show once the gate is cleared; solveMs: the user's solve.
const deps = { platform: process.platform, detectMs: 30_000, solveMs: 10 * 60_000 };

let shown = false;

/** 'change' whenever `zoomCaptchaState()` may have changed (/auth/events subscribes). */
export const zoomCaptchaEvents = new EventEmitter();

/** True while the zoom window is on screen waiting for the user to solve a captcha. */
export function zoomCaptchaState() {
  return shown;
}

/** Tests swap the platform and the timeouts; → a function restoring the previous ones. */
export function configureZoomCaptcha(overrides) {
  const prev = { ...deps };
  Object.assign(deps, overrides);
  return () => Object.assign(deps, prev);
}

/** The solve budget, so the caller can keep its .mp4 sniff armed across it. */
export const captchaSolveMs = () => deps.solveMs;

function setShown(value) {
  if (shown === value) return;
  shown = value;
  zoomCaptchaEvents.emit('change');
}

// A Playwright wait that ran out → false; anything else (the window closed) propagates.
function timedOut(err) {
  if (err?.name === 'TimeoutError') return false;
  throw err;
}

/** Is a captcha frame on screen right now? */
export const captchaVisible = (page) => page.isVisible(CAPTCHA);

/** Past the gate: → 'frame' (a visible captcha frame), 'noPlayer' (no player in detectMs) or null. */
export async function detectCaptcha(page) {
  const found = await page
    .waitForSelector(`${PLAYER}, ${CAPTCHA}`, { state: 'visible', timeout: deps.detectMs })
    .then(() => true, timedOut);
  if (!found) return 'noPlayer';
  return (await captchaVisible(page)) ? 'frame' : null;
}

/**
 * Off Windows there is no window to show: a captcha frame is refused, and a share with no player
 * (expired, deleted, sign-in only, or a captcha we cannot see) is the plain no-media failure.
 * @param {string} url  the share
 * @param {'frame'|'noPlayer'} found  what detectCaptcha saw
 */
export function requireCaptchaWindow(url, found) {
  if (deps.platform === 'win32') return;
  if (found === 'noPlayer') throw noMediaRequest(url);
  throw new CodedError(
    'zoom_captcha_unsupported',
    { url },
    `zoom share ${url} shows a captcha, which can only be solved in a visible window (Windows)`,
  );
}

/** No .mp4 could be captured from the share at `url`. */
export function noMediaRequest(url) {
  return new CodedError(
    'zoom_no_media_request',
    { url },
    `No .mp4 request captured on zoom share ${url} (passcode/player may need a manual trigger)`,
  );
}

/**
 * Show the window until the player shows with no captcha frame, handing a bare gate to `passGate`;
 * `zoom_captcha_timeout` after solveMs. The state clears and the window hides however it ends.
 * @param {import('playwright').Page} page
 * @param {string} url  the share
 * @param {() => Promise<unknown>} passGate  submits the stored passcode (throws PasscodeError)
 */
export async function awaitCaptchaSolve(page, url, passGate) {
  const deadline = Date.now() + deps.solveMs;
  setShown(true);
  try {
    await bounds(page, ON_SCREEN);
    await page.bringToFront().catch(() => {});
    if (!(await solved(page, deadline, passGate))) {
      throw new CodedError(
        'zoom_captcha_timeout',
        { url },
        `the captcha on zoom share ${url} was not solved in time`,
      );
    }
    console.log('[zoom] captcha solved');
  } finally {
    setShown(false);
    // FASTSTUDY_ZOOM_VISIBLE=1 keeps the window on screen for watching (zoomBrowser.js).
    if (process.env.FASTSTUDY_ZOOM_VISIBLE !== '1') await bounds(page, OFF_SCREEN);
  }
}

// The player visible and no captcha frame over it, before the deadline; false once it passes. A
// captcha solved in front of the gate leaves the gate, which takes the stored passcode again.
async function solved(page, deadline, passGate) {
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    const shown = await page
      .waitForSelector(`${PLAYER}, ${GATE}`, { state: 'visible', timeout: left })
      .then(() => true, timedOut);
    if (!shown) return false;
    if (!(await captchaVisible(page))) {
      if (await page.isVisible(PLAYER)) return true;
      await passGate();
      continue;
    }
    await page
      .waitForSelector(CAPTCHA, { state: 'detached', timeout: Math.max(1, deadline - Date.now()) })
      .catch(timedOut);
  }
}

// Window position through CDP, as the challenge window moves its own; cosmetic, so a failure never fails the capture.
async function bounds(page, rect) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: rect });
    await cdp.detach().catch(() => {});
  } catch {
    // the window may already be gone
  }
}
