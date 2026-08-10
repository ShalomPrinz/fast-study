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

const TIMEOUT_MS = 10_000;

// fetch already does the two things this probe needs from a redirect chain: it follows
// hops (so Content-Length describes the file, not a 3xx stub) and drops Cookie/Authorization
// when a hop changes origin — captured credentials belong to the issuing origin only.
// Null on any failure, so a dead URL degrades to "unknown size" rather than throwing.
async function requestFinal(url, headers, method, extraHeaders) {
  // headersToObject drops `host`, so each hop's Host is derived from its own URL.
  try {
    return await fetch(url, {
      method,
      headers: { ...headersToObject(headers), ...(extraHeaders ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

// HEAD, then fall back to a 1-byte ranged GET and read Content-Range's total.
// Both hit the post-redirect final response; a 3xx never counts as the answer.
export async function probeContentLength(url, headers) {
  const head = await requestFinal(url, headers, 'HEAD');
  if (head) {
    head.body?.cancel();
    const len = head.headers.get('content-length');
    if (head.status < 400 && len) return +len;
  }
  const ranged = await requestFinal(url, headers, 'GET', { Range: 'bytes=0-0' });
  if (ranged) {
    // Cancel rather than drain: a server that ignores Range answers 200 with the whole
    // file, and the probe must not pull a multi-GB body just to read one header.
    ranged.body?.cancel();
    const cr = ranged.headers.get('content-range');
    const m = cr && cr.match(/\/(\d+)\s*$/);
    if (m) return +m[1];
  }
  return null;
}
