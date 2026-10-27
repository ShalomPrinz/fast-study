import { headersToObject } from './probe.js';
import {
  parsePlaylist,
  selectStreams,
  pickVariant,
  isHlsUrl,
  segmentCaptures,
} from '../hlsPlaylist.js';

const TIMEOUT_MS = 10_000;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
export const MAX_CAPTURES = 30;
// `.mp4` captures are never fetched, so they are capped apart from the playlists.
export const MAX_MP4_CAPTURES = 100;
// Media playlists fetched in one request to look up segment captures, and how many go at once.
export const MAX_MEDIA_LOOKUPS = 20;
const LOOKUP_CONCURRENCY = 4;

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
async function estimateMaster(master, url, headers, known = new Map()) {
  const variant = pickVariant(master);
  if (!variant) return { durationSeconds: null, estimatedBytes: null };
  const parsed =
    known.get(variant.url) ??
    (await fetchPlaylist(variant.url, headers, new URL(url).origin)).parsed;
  const durationSeconds = parsed?.kind === 'media' ? parsed.durationSeconds : null;
  const estimatedBytes =
    durationSeconds && variant.bandwidth
      ? Math.round((durationSeconds * variant.bandwidth) / 8)
      : null;
  return { durationSeconds, estimatedBytes };
}

// Offer the streams worth showing from the `.m3u8` captures `{url, headers}`; other captures only
// match playlist segments -> `{ streams, failed, segments }`. Shapes: docs/DOWNLOAD.md ("HLS").
export async function classifyCaptures(captures) {
  const playlists = captures.filter((c) => isHlsUrl(c.url) || !URL.canParse(c.url));
  const mp4Urls = [...new Set(captures.filter((c) => !playlists.includes(c)).map((c) => c.url))];
  const headersOf = new Map(playlists.map((c) => [c.url, c.headers]));
  const fetched = await Promise.all(
    playlists.map(async (c) => ({ url: c.url, ...(await fetchPlaylist(c.url, c.headers)) })),
  );
  const failed = fetched.filter((f) => f.error).map((f) => ({ url: f.url, detail: f.error }));
  const entries = fetched.filter((f) => f.parsed).map((f) => ({ url: f.url, parsed: f.parsed }));
  const parsedOf = new Map(entries.map((e) => [e.url, e.parsed]));

  // Segments no captured media playlist lists: look in the captured masters' own media playlists.
  let segments = segmentCaptures(
    mp4Urls,
    entries.map((e) => e.parsed),
  );
  const lookedUp = new Map();
  if (segments.length < mp4Urls.length) {
    // Round-robin over masters, each variant URL once, so one master can't use the whole cap.
    const queues = entries
      .filter((e) => e.parsed.kind === 'master')
      .map((e) => ({
        e,
        urls: e.parsed.mediaUrls.filter((u) => !parsedOf.has(u)),
      }));
    const queued = new Set();
    const todo = [];
    for (let i = 0; queues.some((q) => i < q.urls.length); i++) {
      for (const q of queues) {
        const u = q.urls[i];
        if (u && !queued.has(u)) {
          queued.add(u);
          todo.push({ u, e: q.e });
        }
      }
    }
    todo.length = Math.min(todo.length, MAX_MEDIA_LOOKUPS);
    for (let i = 0; i < todo.length && segments.length < mp4Urls.length; i += LOOKUP_CONCURRENCY) {
      await Promise.all(
        todo.slice(i, i + LOOKUP_CONCURRENCY).map(async ({ u, e }) => {
          const { parsed } = await fetchPlaylist(u, headersOf.get(e.url), new URL(e.url).origin);
          if (parsed) lookedUp.set(u, parsed);
        }),
      );
      segments = segmentCaptures(mp4Urls, [...entries.map((x) => x.parsed), ...lookedUp.values()]);
    }
  }

  const streams = await Promise.all(
    selectStreams(entries).map(async (s) => {
      if (s.kind === 'media') return { ...s, estimatedBytes: null };
      const est = await estimateMaster(parsedOf.get(s.url), s.url, headersOf.get(s.url), lookedUp);
      return { ...s, ...est };
    }),
  );
  return { streams, failed, segments };
}

// The `/probe-size` answer for an HLS capture: the master's estimate, or null for anything else.
export async function probeHlsBytes(url, headers) {
  if (!isHlsUrl(url)) return null;
  const { parsed } = await fetchPlaylist(url, headers);
  if (parsed?.kind !== 'master') return null;
  return (await estimateMaster(parsed, url, headers)).estimatedBytes;
}
