import { execFile } from 'node:child_process';
import path from 'node:path';

const ENV_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'];
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

// `reg query` on the per-user Internet Settings key; reg.exe ships with Windows, so no bundled binary.
// execFile buffers stderr, so nothing of reg.exe's reaches auto's log.
function queryRegistry() {
  const reg = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
  return new Promise((resolve, reject) => {
    execFile(
      reg,
      ['query', KEY],
      { encoding: 'utf8', timeout: 3000, windowsHide: true },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });
}

function hasSystemProxy(out) {
  return (
    /^\s*ProxyEnable\s+REG_DWORD\s+0x0*[1-9a-f]/im.test(out) ||
    /^\s*AutoConfigURL\s+REG_SZ\s+\S/im.test(out)
  );
}

let system = false; // the settled registry verdict; false while pending, failed or off Windows

/**
 * Reads the Windows system proxy once, off the event loop; call at boot. A failure or timeout means
 * no system proxy and is not retried. Resolves when settled; never rejects.
 */
export function startProxyDetection({
  platform = process.platform,
  readRegistry = queryRegistry,
} = {}) {
  if (platform !== 'win32') return Promise.resolve();
  return readRegistry().then(
    (out) => {
      system = hasSystemProxy(out);
    },
    () => {},
  );
}

/**
 * Which kind of proxy this machine has configured, for diagnosing the split route: Auto's Chromium
 * follows it, Node `fetch` ignores it. 'env' (an HTTP(S)/ALL_PROXY var, either case), 'system'
 * (Windows ProxyEnable=1 or an AutoConfigURL, once the boot read settled), else null. Synchronous.
 */
export function proxyKind(env = process.env) {
  if (ENV_NAMES.some((n) => env[n] || env[n.toLowerCase()])) return 'env';
  return system ? 'system' : null;
}

// Test hook: forget the settled registry verdict.
export function resetProxyKind() {
  system = false;
}
