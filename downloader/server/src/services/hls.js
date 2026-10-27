import { headersToObject } from './probe.js';
import { parsePlaylist, selectStreams, pickVariant, isHlsUrl } from '../hlsPlaylist.js';

const TIMEOUT_MS = 10_000;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
export const MAX_CAPTURES = 30;

// Credentials belong to the lecture site: a playlist on another origin gets the rest of the headers.
const CREDENTIAL_HEADERS = new Set(['cookie', 'authorization']);

// accept-encoding is dropped so the reply is one this process decodes.
function requestHeaders(url, origin, headers) {
  const same = new URL(url).origin === origin;
  const out = headersToObject(headers);
  for (const name of Object.keys(out)) {
    const lower = name.toLowerCase();
    if (lower === 'accept-encoding' || (!same && CREDENTIAL_HEADERS.has(lower))) delete out[name];
  }
  return out;
}

// The body as text, or null once it passes MAX_PLAYLIST_BYTES (the stream is cancelled there).
async function readCapped(res) {
  if (!res.body) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_PLAYLIST_BYTES) {
      await res.body.cancel().catch(() => {});
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// One playlist's parse, or `{ error }` (HTTP status or network text) when it can't be read.
async function fetchPlaylist(url, headers, origin) {
  try {
    const res = await fetch(url, {
      headers: requestHeaders(url, origin ?? new URL(url).origin, headers),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      res.body?.cancel();
      return { error: `HTTP ${res.status}` };
    }
    const text =
      +(res.headers.get('content-length') ?? 0) > MAX_PLAYLIST_BYTES ? null : await readCapped(res);
    if (text === null) {
      res.body?.cancel().catch(() => {});
      return { error: 'playlist too large' };
    }
    return { parsed: parsePlaylist(text, res.url || url) };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

// Duration and size of the 720p-capped variant yt-dlp would pick; null parts when unreadable.
async function estimateMaster(master, url, headers) {
  const variant = pickVariant(master);
  if (!variant) return { durationSeconds: null, estimatedBytes: null };
  const { parsed } = await fetchPlaylist(variant.url, headers, new URL(url).origin);
  const durationSeconds = parsed?.kind === 'media' ? parsed.durationSeconds : null;
  const estimatedBytes =
    durationSeconds && variant.bandwidth
      ? Math.round((durationSeconds * variant.bandwidth) / 8)
      : null;
  return { durationSeconds, estimatedBytes };
}

// Fetch each capture `{url, headers}` and offer the streams worth showing -> `{ streams, failed }`.
// Shapes: docs/DOWNLOAD.md ("HLS").
export async function classifyCaptures(captures) {
  const headersOf = new Map(captures.map((c) => [c.url, c.headers]));
  const fetched = await Promise.all(
    captures.map(async (c) => ({ url: c.url, ...(await fetchPlaylist(c.url, c.headers)) })),
  );
  const failed = fetched.filter((f) => f.error).map((f) => ({ url: f.url, detail: f.error }));
  const entries = fetched.filter((f) => f.parsed).map((f) => ({ url: f.url, parsed: f.parsed }));
  const parsedOf = new Map(entries.map((e) => [e.url, e.parsed]));
  const streams = await Promise.all(
    selectStreams(entries).map(async (s) => {
      if (s.kind === 'media') return { ...s, estimatedBytes: null };
      const est = await estimateMaster(parsedOf.get(s.url), s.url, headersOf.get(s.url));
      return { ...s, ...est };
    }),
  );
  return { streams, failed };
}

// The `/probe-size` answer for an HLS capture: the master's estimate, or null for anything else.
export async function probeHlsBytes(url, headers) {
  if (!isHlsUrl(url)) return null;
  const { parsed } = await fetchPlaylist(url, headers);
  if (parsed?.kind !== 'master') return null;
  return (await estimateMaster(parsed, url, headers)).estimatedBytes;
}
