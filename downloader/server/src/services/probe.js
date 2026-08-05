import http from 'node:http';
import https from 'node:https';

// Replaying a captured Range/conditional header makes the CDN return a partial
// body whose offset-0 MP4 header is missing (unplayable). Stripped everywhere the
// captured headers are reused (probe + curl). See docs/DOWNLOAD.md.
export const SKIP_HEADERS = new Set([
  'range',
  'if-range',
  'if-none-match',
  'if-modified-since',
  'host',
  'content-length',
]);

export function headersToObject(headers) {
  const out = {};
  for (const h of headers ?? []) {
    if (SKIP_HEADERS.has(h.name.toLowerCase())) continue;
    out[h.name] = h.value;
  }
  return out;
}

const MAX_REDIRECTS = 5;

// Credentials are scoped to the origin that issued them; a redirect to another host
// must not receive the lecture site's Cookie/token.
const CROSS_ORIGIN_STRIP = new Set(['cookie', 'authorization']);

function dropCredentials(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !CROSS_ORIGIN_STRIP.has(k.toLowerCase())),
  );
}

// Raw node:http on purpose: the probe replays the captured `Cookie` header, which
// fetch/undici forbid setting. This module is the only place raw http survives.
function requestOnce(url, headers, method) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve(null);
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(url, { method, headers }, (res) => {
      res.resume();
      resolve(res);
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// Raw http doesn't auto-follow, and a 3xx's Content-Length describes the redirect stub,
// not the file — so follow Location ourselves (capped, so a loop ends as null not a hang).
async function requestFinal(url, headers, method, extraHeaders) {
  // headersToObject drops `host`, so each hop's Host is derived from its own URL.
  let sendHeaders = { ...headersToObject(headers), ...(extraHeaders ?? {}) };
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(current, sendHeaders, method);
    if (!res) return null;
    const loc = res.headers.location;
    if (!loc || !res.statusCode || res.statusCode < 300 || res.statusCode >= 400) return res;
    let next;
    try {
      next = new URL(loc, current); // a relative Location is legal
    } catch {
      return res;
    }
    if (next.origin !== new URL(current).origin) sendHeaders = dropCredentials(sendHeaders);
    current = next.href;
  }
  return null;
}

// HEAD, then fall back to a 1-byte ranged GET and read Content-Range's total.
// Both hit the post-redirect final response; a 3xx never counts as the answer.
export async function probeContentLength(url, headers) {
  const head = await requestFinal(url, headers, 'HEAD');
  if (head) {
    const len = head.headers['content-length'];
    if (head.statusCode && head.statusCode < 400 && len) return +len;
  }
  const ranged = await requestFinal(url, headers, 'GET', { Range: 'bytes=0-0' });
  if (ranged) {
    const cr = ranged.headers['content-range'];
    const m = cr && cr.match(/\/(\d+)\s*$/);
    if (m) return +m[1];
  }
  return null;
}
