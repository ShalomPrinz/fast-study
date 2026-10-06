// The fake site's live settings and their transitions — `/control` and the fake tool's `/tool`
// question — apart from the server so the unit tests can drive them without a port or TLS.
import { DEFAULT_DOWNLOAD_MS } from '../lib/env.mjs';

// 'blocked' (bot-protection challenge on every route), 'blocked_ws' (the same challenge on the
// web-service API only, so the browser login passes and Node's calls are refused, as for a real
// user) and 'invalidtoken' are the upstream refusals the downloader has typed errors for; the other four are a site it must refuse — `not_moodle` and
// `mobile_service_off` at the pre-login probe, `missing_function` and `downloads_disabled` at login.
export const MODES = [
  'ok',
  'blocked',
  'blocked_ws',
  'invalidtoken',
  'not_moodle',
  'mobile_service_off',
  'missing_function',
  'downloads_disabled',
];

/** The site's mode and the fake tool's download speed, with the one-time drop per /die/ URL. */
export function createSiteControl() {
  const state = { mode: 'ok', downloadMs: DEFAULT_DOWNLOAD_MS };
  const died = new Set();
  return {
    state,
    // `reset` is what a reseed sends; any other field sets only itself. Fields apply in order, so a
    // bad one throws after the ones before it have landed.
    control(body) {
      if (body.reset) {
        state.mode = 'ok';
        state.downloadMs = DEFAULT_DOWNLOAD_MS;
        died.clear();
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
      return { mode: state.mode, downloadMs: state.downloadMs };
    },
    // Asked by the fake tool once per download: how long to take, and whether to drop halfway.
    tool(target) {
      const die = target.includes('/die/') && !died.has(target);
      if (die) died.add(target);
      return { downloadMs: state.downloadMs, die };
    },
  };
}
