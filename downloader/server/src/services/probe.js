import http from 'node:http';
import https from 'node:https';

// Replaying a captured Range/conditional header makes the CDN return a partial
// body whose offset-0 MP4 header is missing (unplayable). Stripped everywhere the
// captured headers are reused (probe + curl). See docs/DOWNLOAD.md.
export const SKIP_HEADERS = new Set([
  'range', 'if-range', 'if-none-match', 'if-modified-since',
  'host', 'content-length',
]);

export function headersToObject(headers) {
  const out = {};
  for (const h of headers ?? []) {
    if (SKIP_HEADERS.has(h.name.toLowerCase())) continue;
    out[h.name] = h.value;
  }
  return out;
}

// Raw node:http on purpose: the probe replays the captured `Cookie` header, which
// fetch/undici forbid setting. This module is the only place raw http survives.
function requestHead(url, headers, method, extraHeaders) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      url,
      { method, headers: { ...headersToObject(headers), ...(extraHeaders ?? {}) } },
      (res) => { res.resume(); resolve(res); },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// HEAD, then fall back to a 1-byte ranged GET and read Content-Range's total.
export async function probeContentLength(url, headers) {
  const head = await requestHead(url, headers, 'HEAD');
  if (head) {
    const len = head.headers['content-length'];
    if (head.statusCode && head.statusCode < 400 && len) return +len;
  }
  const ranged = await requestHead(url, headers, 'GET', { Range: 'bytes=0-0' });
  if (ranged) {
    const cr = ranged.headers['content-range'];
    const m = cr && cr.match(/\/(\d+)\s*$/);
    if (m) return +m[1];
  }
  return null;
}
