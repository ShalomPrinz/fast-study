// The fake site's live settings and their transitions — `/control` and the fake tool's `/tool`
// question — apart from the server so the unit tests can drive them without a port or TLS.
import { DEFAULT_DOWNLOAD_MS } from '../lib/env.mjs';

// 'blocked' (bot-protection challenge on every route), 'blocked_ws' (the same challenge on the
// web-service API only, so the browser login passes and Node's calls are refused, as for a real
// user), 'radware' (the challenge for any request without the clearance cookie only a solved
// browser holds — Radware's real shape) and 'invalidtoken' are the upstream refusals the downloader has typed errors for; the next four are a site it must refuse — `not_moodle` and
// `mobile_service_off` at the pre-login probe, `missing_function` and `downloads_disabled` at login.
// 'no_enrol_function' drops core_enrol_get_users_courses (refused as accessexception): the next Connect leaves the picker on paste.
export const MODES = [
  'ok',
  'blocked',
  'blocked_ws',
  'radware',
  'invalidtoken',
  'not_moodle',
  'mobile_service_off',
  'missing_function',
  'downloads_disabled',
  'no_enrol_function',
];

/** The site's mode, the fake tool's download speed and the Moodle hold, with the one-time drop per /die/ URL. */
export function createSiteControl() {
  const state = { mode: 'ok', downloadMs: DEFAULT_DOWNLOAD_MS, hold: false };
  let solveArmed = false;
  const died = new Set();
  // Moodle requests parked by `hold`, each answered once it lifts.
  let parked = [];
  const release = () => {
    const waiting = parked;
    parked = [];
    for (const answer of waiting) answer();
  };
  return {
    state,
    // `reset` is what a reseed sends; any other field sets only itself. Fields apply in order, so a
    // bad one throws after the ones before it have landed.
    control(body) {
      if (body.reset) {
        state.mode = 'ok';
        state.downloadMs = DEFAULT_DOWNLOAD_MS;
        solveArmed = false;
        died.clear();
        state.hold = false;
      }
      if (body.mode) {
        if (!MODES.includes(body.mode)) throw new Error(`mode: one of ${MODES.join(' | ')}`);
        state.mode = body.mode;
      }
      if (body.downloadMs !== undefined) {
        const ms = Number(body.downloadMs);
        if (!Number.isFinite(ms) || ms < 0) throw new Error('downloadMs: ms ≥ 0');
        state.downloadMs = ms;
      }
      if (body.hold !== undefined) {
        if (typeof body.hold !== 'boolean') throw new Error('hold: true | false');
        state.hold = body.hold;
      }
      if (!state.hold) release();
      // Arms one solve: the next captcha page that asks clears its browser.
      if (body.solve) solveArmed = true;
      return { mode: state.mode, downloadMs: state.downloadMs, hold: state.hold };
    },
    // A Moodle request: answered now, or parked until the hold lifts — the in-flight call auto/'s
    // lock then stays held for.
    admit(answer) {
      if (state.hold) parked.push(answer);
      else answer();
    },
    parked: () => parked.length,
    // Asked by an open captcha page; true once per armed solve.
    takeSolve() {
      const solved = solveArmed;
      solveArmed = false;
      return solved;
    },
    // Asked by the fake tool once per download: how long to take, and whether to drop halfway.
    tool(target) {
      const die = target.includes('/die/') && !died.has(target);
      if (die) died.add(target);
      return { downloadMs: state.downloadMs, die };
    },
  };
}
