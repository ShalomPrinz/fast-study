// Pure HLS playlist logic: parse, audio detection, variant choice, master/variant dedupe.
// Network lives in services/hls.js (docs/DOWNLOAD.md, "HLS").

// The same 720p cap the yt-dlp format selection applies.
export const HLS_MAX_HEIGHT = 720;

const AUDIO_CODEC_RE = /^(mp4a|ac-3|ec-3|opus|flac|mp3|alac)/i;
const VIDEO_CODEC_RE = /^(avc1|avc3|hvc1|hev1|vp0?[89]|av01|dvh1)/i;

// True for a URL whose path (not query) ends in `.m3u8`, or `.panobf2` (Panopto's renamed playlists).
export function isHlsUrl(url) {
  try {
    return /\.(m3u8|panobf2)$/.test(new URL(url).pathname.toLowerCase());
  } catch {
    return false;
  }
}

// `KEY=value,KEY2="quoted, value"` -> { KEY, KEY2 }.
function parseAttributes(text) {
  const out = {};
  for (const m of text.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

// Same resource ignoring the query: a CDN token that rotates between fetches must still dedupe.
const bare = (url) => url.split(/[?#]/)[0];

function resolve(uri, base) {
  try {
    return new URL(uri, base).href;
  } catch {
    return null;
  }
}

// Parse a playlist body fetched from `baseUrl` into a master, media or `{kind:'unknown'}` result.
// Shapes: docs/DOWNLOAD.md ("HLS").
export function parsePlaylist(text, baseUrl) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') return { kind: 'unknown' };

  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF:'))) {
    const variants = [];
    const audioGroups = {};
    const mediaUrls = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
        const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
        const url = uri ? resolve(uri, baseUrl) : null;
        if (!url) continue;
        const height = Number(/x(\d+)$/.exec(attrs.RESOLUTION ?? '')?.[1]) || null;
        variants.push({
          url,
          bandwidth: Number(attrs['AVERAGE-BANDWIDTH'] || attrs.BANDWIDTH) || null,
          height,
          codecs: attrs.CODECS ? attrs.CODECS.split(',').map((c) => c.trim()) : null,
          audioGroup: attrs.AUDIO ?? null,
        });
        mediaUrls.push(url);
      } else if (
        line.startsWith('#EXT-X-MEDIA:') ||
        line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')
      ) {
        const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
        const url = attrs.URI ? resolve(attrs.URI, baseUrl) : null;
        if (url) mediaUrls.push(url);
        if (line.startsWith('#EXT-X-MEDIA:') && attrs.TYPE === 'AUDIO') {
          // A group with no URI is audio muxed into the variants themselves.
          (audioGroups[attrs['GROUP-ID']] ??= []).push(url);
        }
      }
    }
    return { kind: 'master', variants, audioGroups, mediaUrls };
  }

  if (lines.some((l) => l.startsWith('#EXTINF:'))) {
    let durationSeconds = 0;
    const segments = [];
    const resources = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF:')) {
        durationSeconds += parseFloat(lines[i].slice(8)) || 0;
        const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
        if (uri) {
          segments.push(uri.split(/[?#]/)[0].toLowerCase());
          const url = resolve(uri, baseUrl);
          if (url) resources.add(bare(url));
        }
      } else if (lines[i].startsWith('#EXT-X-MAP:')) {
        const map = parseAttributes(lines[i].slice('#EXT-X-MAP:'.length)).URI;
        const url = map ? resolve(map, baseUrl) : null;
        if (url) resources.add(bare(url));
      }
    }
    const audioOnly =
      segments.length > 0 && segments.every((s) => /\.(aac|m4a|mp3|ac3|ec3)$/.test(s));
    return {
      kind: 'media',
      durationSeconds: durationSeconds || null,
      audioOnly,
      resourceUrls: [...resources],
    };
  }
  return { kind: 'unknown' };
}

// True/false/null (unknown) audio of a parsed master; rules in docs/DOWNLOAD.md ("Audio").
export function masterHasAudio(master) {
  if (Object.keys(master.audioGroups).length) return true;
  if (master.variants.some((v) => v.codecs?.some((c) => AUDIO_CODEC_RE.test(c)))) return true;
  if (master.variants.length && master.variants.every((v) => v.codecs)) return false;
  return null;
}

// A master whose every variant declares CODECS and none is video is audio-only.
export function masterHasVideo(master) {
  if (master.variants.some((v) => v.codecs?.some((c) => VIDEO_CODEC_RE.test(c)))) return true;
  if (master.variants.some((v) => v.height)) return true;
  if (master.variants.length && master.variants.every((v) => v.codecs)) return false;
  return null;
}

/** The variant yt-dlp's 720p cap would take: the largest bandwidth at or under the cap, else the smallest above. */
export function pickVariant(master) {
  const bw = (v) => v.bandwidth ?? 0;
  const under = master.variants.filter((v) => !v.height || v.height <= HLS_MAX_HEIGHT);
  if (under.length) return under.reduce((a, b) => (bw(b) > bw(a) ? b : a));
  return master.variants.reduce(
    (a, b) => ((b.height ?? 0) < (a.height ?? 0) ? b : a),
    master.variants[0],
  );
}

// Which captured playlists `[{url, parsed}]` to offer, audio first (docs/DOWNLOAD.md, "HLS").
// `entries` are newest first (the extension's store order): of captures with the same content the first wins.
export function selectStreams(entries) {
  const referenced = new Set();
  for (const e of entries) {
    if (e.parsed.kind === 'master') for (const u of e.parsed.mediaUrls) referenced.add(bare(u));
  }

  // Same segments ignoring the query = same stream, however often the player re-minted its token.
  // A master keeps its variants' queries: a CDN may pick the stream by them (`?id=<video>`).
  const contentKey = (url, urls, strip = bare) =>
    urls.length ? [...new Set(urls.map(strip))].sort().join('\n') : bare(url);

  const out = [];
  const seen = new Set();
  for (const { url, parsed } of entries) {
    if (parsed.kind === 'master') {
      const key = `M${contentKey(url, parsed.mediaUrls, (u) => u)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        url,
        kind: 'master',
        hasAudio: masterHasAudio(parsed),
        hasVideo: masterHasVideo(parsed),
      });
    } else if (parsed.kind === 'media' && !referenced.has(bare(url))) {
      const key = `P${contentKey(url, parsed.resourceUrls)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        url,
        kind: 'media',
        hasAudio: parsed.audioOnly ? true : null,
        hasVideo: parsed.audioOnly ? false : null,
        durationSeconds: parsed.durationSeconds,
      });
    }
  }
  const tier = (s) => (s.hasAudio === true ? 0 : s.hasAudio === null ? 1 : 2);
  return out
    .map((s, i) => [s, i])
    .sort((a, b) => tier(a[0]) - tier(b[0]) || a[1] - b[1])
    .map(([s]) => s);
}

// The captured `.mp4` URLs that are an init section or segment of any parsed media playlist (query ignored).
export function segmentCaptures(mp4Urls, parsedList) {
  const known = new Set();
  for (const p of parsedList) if (p.kind === 'media') for (const u of p.resourceUrls) known.add(u);
  return mp4Urls.filter((u) => known.has(bare(u)));
}
