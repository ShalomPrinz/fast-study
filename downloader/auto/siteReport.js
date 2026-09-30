// A site we cannot serve, as one Sentry warning per (host, reason) per process — the probe runs on
// every blur, so without the dedupe one user would flood it. A no-op without a DSN (every dev run).
import * as Sentry from '@sentry/node';
import { enabled } from '@faststudy/sentry';

const sent = new Set();

/**
 * @param {{ site: string, stage: 'probe'|'login', reason: string, release?: string|null }} report
 */
export function reportUnsupportedSite({ site, stage, reason, release = null }) {
  if (!enabled()) return;
  let host;
  try {
    host = new URL(site).host;
  } catch {
    return;
  }
  const key = `${host}\n${reason}`;
  if (sent.has(key)) return;
  sent.add(key);
  Sentry.captureMessage('moodle_site_unsupported', {
    level: 'warning',
    tags: { moodle_host: host, moodle_stage: stage, moodle_reason: reason },
    extra: { release },
  });
}
