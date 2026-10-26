// Decides and builds the browser's private network namespace (see the README for why).
// Side-effect-free apart from `probe`, so tests import it without a port.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'netns-inner.mjs');

// Set to 0 to launch the browser in the host namespace.
export const DISABLE_ENV = 'HB_BROWSER_NETNS';

/** The user-visible reason the browser is not isolated, or null when the namespace works. */
export function fallbackReason({ disabled, unshare, lo }) {
  if (disabled) return `disabled by ${DISABLE_ENV}=0`;
  if (unshare) return `unshare -rn failed: ${unshare}`;
  if (lo) return `cannot bring lo up: ${lo}`;
  return null;
}

const firstLine = (text) => String(text).trim().split('\n')[0] || 'no output';

// Runs the namespace's one setup step, so a runner that restricts user namespaces fails here and not at launch.
function attempt(cmd, args) {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout: 5000 }, (error, _out, err) =>
      resolve(error ? firstLine(err || error.message) : null),
    ),
  );
}

/** Try the namespace once: `unshare -rn` itself, then `ip link set lo up` inside it. */
export async function probe(env = process.env) {
  if (env[DISABLE_ENV] === '0') return fallbackReason({ disabled: true });
  const unshare = await attempt('unshare', ['-rn', 'true']);
  if (unshare) return fallbackReason({ unshare });
  const lo = await attempt('unshare', ['-rn', 'ip', 'link', 'set', 'lo', 'up']);
  return fallbackReason({ lo });
}

/** The wrapper script's text: chromium's stand-in executable, which enters the namespace. */
export function wrapperScript(nodePath = process.execPath) {
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\nexec unshare -rn ${q(nodePath)} ${q(INNER)} "$@"\n`;
}
