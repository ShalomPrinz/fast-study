import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHlsUrl,
  parsePlaylist,
  masterHasAudio,
  pickVariant,
  selectStreams,
} from '../src/hlsPlaylist.js';
import http from 'node:http';
import { classifyCaptures, MAX_MEDIA_LOOKUPS } from '../src/services/hls.js';
import { buildHlsArgs, buildCookieJar } from '../src/downloaders/ytdlp.js';

const BASE = 'https://host.example/p/a/master.m3u8?t=1';

const MUXED = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080/index.m3u8
`;
const VIDEO_ONLY = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="avc1.4d401f"
v/index.m3u8
`;
const SEPARATE_AUDIO = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="audio/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="aud"
v/index.m3u8
`;
const NO_INFO = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000
v/index.m3u8
`;
const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
s0.ts
#EXTINF:4.5,
s1.ts
#EXT-X-ENDLIST
`;
const AAC_MEDIA = `#EXTM3U
#EXTINF:6.0,
s0.aac?x=1
#EXT-X-ENDLIST
`;

test('isHlsUrl looks at the path, not the query', () => {
  assert.equal(isHlsUrl('https://a.example/x/master.m3u8?token=1'), true);
  assert.equal(isHlsUrl('https://a.example/x/video.mp4?f=a.m3u8'), false);
  assert.equal(isHlsUrl('nope'), false);
});

test('parse: master variants resolve against the playlist URL', () => {
  const p = parsePlaylist(MUXED, BASE);
  assert.equal(p.kind, 'master');
  assert.equal(p.variants[1].url, 'https://host.example/p/a/720/index.m3u8');
  assert.equal(p.variants[1].height, 720);
  assert.equal(p.variants[1].bandwidth, 3000000);
});

test('parse: media sums EXTINF; non-playlists are unknown', () => {
  assert.equal(parsePlaylist(MEDIA, BASE).durationSeconds, 10.5);
  assert.equal(parsePlaylist('<html>', BASE).kind, 'unknown');
  assert.equal(parsePlaylist('', BASE).kind, 'unknown');
});

test('audio detection: codecs, audio group, video-only, unknown', () => {
  const has = (t) => masterHasAudio(parsePlaylist(t, BASE));
  assert.equal(has(MUXED), true);
  assert.equal(has(SEPARATE_AUDIO), true);
  assert.equal(has(VIDEO_ONLY), false);
  assert.equal(has(NO_INFO), null);
});

test('pickVariant takes the best variant under the 720p cap', () => {
  assert.equal(pickVariant(parsePlaylist(MUXED, BASE)).height, 720);
  const only1080 = parsePlaylist(
    MUXED.split('#EXT-X-STREAM-INF').slice(0, 1).join('') +
      `#EXT-X-STREAM-INF:BANDWIDTH=6,RESOLUTION=1920x1080\n1080/i.m3u8\n`,
    BASE,
  );
  assert.equal(pickVariant(only1080).height, 1080);
});

test('selectStreams offers masters only, hides referenced variants, audio first', () => {
  const entries = [
    {
      url: 'https://h.example/screen/master.m3u8?a=1',
      parsed: parsePlaylist(VIDEO_ONLY, 'https://h.example/screen/master.m3u8'),
    },
    {
      url: 'https://h.example/screen/v/index.m3u8?a=2',
      parsed: parsePlaylist(MEDIA, 'https://h.example/screen/v/index.m3u8'),
    },
    {
      url: 'https://h.example/cam/master.m3u8',
      parsed: parsePlaylist(MUXED, 'https://h.example/cam/master.m3u8'),
    },
    {
      url: 'https://h.example/cam/720/index.m3u8',
      parsed: parsePlaylist(MEDIA, 'https://h.example/cam/720/index.m3u8'),
    },
    {
      url: 'https://h.example/cam/master.m3u8',
      parsed: parsePlaylist(MUXED, 'https://h.example/cam/master.m3u8'),
    },
  ];
  const out = selectStreams(entries);
  assert.deepEqual(
    out.map((s) => [s.url, s.hasAudio]),
    [
      ['https://h.example/cam/master.m3u8', true],
      ['https://h.example/screen/master.m3u8?a=1', false],
    ],
  );
});

test('selectStreams keeps one unreferenced media playlist; audio-only media is audio', () => {
  const out = selectStreams([
    { url: 'https://h.example/a/index.m3u8?x=1', parsed: parsePlaylist(MEDIA, BASE) },
    { url: 'https://h.example/a/index.m3u8?x=2', parsed: parsePlaylist(MEDIA, BASE) },
    { url: 'https://h.example/b/index.m3u8', parsed: parsePlaylist(AAC_MEDIA, BASE) },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://h.example/b/index.m3u8');
  assert.equal(out[0].hasAudio, true);
  assert.equal(out[0].hasVideo, false);
  assert.equal(out[1].hasAudio, null);
  assert.equal(out[1].durationSeconds, 10.5);
});

test('selectStreams collapses masters with the same variants and different tokens to the newest', () => {
  const master = (inv) =>
    `https://cdn.example/s/1.hls/master.m3u8?InvocationID=${inv}&StreamID=d49c`;
  const body = () =>
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
298280/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
409707/index.m3u8
`;
  const entry = (inv) => ({ url: master(inv), parsed: parsePlaylist(body(), master(inv)) });
  const out = selectStreams([entry('new'), entry('old')]);
  assert.deepEqual(
    out.map((s) => s.url),
    [master('new')],
  );
});

test('selectStreams keeps masters that share a path but list different variants', () => {
  const url = (q) => `https://cdn.example/s/1.hls/master.m3u8?StreamID=${q}`;
  const mk = (q, v) => ({
    url: url(q),
    parsed: parsePlaylist(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n${v}/index.m3u8\n`, url(q)),
  });
  const out = selectStreams([mk('a', '111'), mk('b', '222')]);
  assert.equal(out.length, 2);
});

test('selectStreams keeps masters whose variants share a path but differ in query', () => {
  const mk = (id) => {
    const url = `https://cdn.example/hls/master.m3u8?t=${id}`;
    const body = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8?id=${id}&q=720\n`;
    return { url, parsed: parsePlaylist(body, url) };
  };
  assert.equal(selectStreams([mk('a'), mk('b')]).length, 2);
});

test('buildHlsArgs replays plain headers, never credentials, and names the cookie jar', () => {
  const args = buildHlsArgs(
    'https://h.example/m.m3u8',
    [
      { name: 'Cookie', value: 'a=b; c=d' },
      { name: 'Authorization', value: 'Bearer x' },
      { name: 'Range', value: 'bytes=0-1' },
      { name: 'Accept-Encoding', value: 'br' },
      { name: 'Referer', value: 'https://h.example/v' },
      { name: 'Bad Name', value: 'x' },
      { name: 'X-Evil', value: 'a\r\nB: c' },
    ],
    '/tmp/j/cookies.txt',
  );
  const pairs = args.flatMap((a, i) => (a === '--add-header' ? [args[i + 1]] : []));
  assert.deepEqual(pairs, ['Referer: https://h.example/v']);
  assert.equal(args[args.indexOf('--cookies') + 1], '/tmp/j/cookies.txt');
  assert.equal(args.at(-1), 'https://h.example/m.m3u8');
  assert.ok(!buildHlsArgs('https://h.example/m.m3u8', []).includes('--cookies'));
});

test('buildCookieJar scopes the Cookie header to the capture host only', () => {
  const jar = buildCookieJar('https://h.example/m.m3u8', [
    { name: 'cookie', value: 'a=b; c=d=e; bad; =x; ctl=\u0001' },
  ]);
  const rows = jar
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t'));
  assert.deepEqual(
    rows.map((r) => [r[0], r[1], r[2], r[3], r[5], r[6]]),
    [
      ['h.example', 'FALSE', '/', 'TRUE', 'a', 'b'],
      ['h.example', 'FALSE', '/', 'TRUE', 'c', 'd=e'],
    ],
  );
  assert.equal(buildCookieJar('https://h.example/m.m3u8', [{ name: 'Referer', value: 'x' }]), null);
});

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, '127.0.0.1', () => {
      resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` });
    });
  });
}

test('classifyCaptures: an unparseable capture URL is one failed row, not a batch failure', async () => {
  const { srv, base } = await serve((_req, res) => res.end('#EXTM3U\n#EXTINF:4,\ns.ts\n'));
  try {
    const out = await classifyCaptures([
      { url: 'http://[', headers: [] },
      { url: `${base}/a.m3u8`, headers: [] },
    ]);
    assert.deepEqual(
      out.failed.map((f) => f.url),
      ['http://['],
    );
    assert.equal(out.streams.length, 1);
  } finally {
    srv.close();
  }
});

test('classifyCaptures: a chunked body past the size cap is cut off, not buffered', async () => {
  let sent = 0;
  const { srv, base } = await serve((_req, res) => {
    res.write('#EXTM3U\n');
    const pump = () => {
      if (res.destroyed || sent > 64 * 1024 * 1024) return res.end();
      sent += 1024 * 1024;
      res.write(Buffer.alloc(1024 * 1024, 0x23), pump);
    };
    pump();
  });
  try {
    const out = await classifyCaptures([{ url: `${base}/big.m3u8`, headers: [] }]);
    assert.deepEqual(out.failed, [{ url: `${base}/big.m3u8`, detail: 'playlist too large' }]);
    assert.ok(sent < 16 * 1024 * 1024, `server wrote ${sent}`);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

const FMP4_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
v/index.m3u8?t=2
#EXT-X-STREAM-INF:BANDWIDTH=300000,CODECS="mp4a.40.2"
a/index.m3u8
`;
const FMP4_MEDIA = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="fragmented.mp4?sig=a",BYTERANGE="800@0"
#EXTINF:6.0,
#EXT-X-BYTERANGE:5000@800
fragmented.mp4?sig=a
#EXTINF:4.0,
#EXT-X-BYTERANGE:4000@5800
fragmented.mp4?sig=a
#EXT-X-ENDLIST
`;

test('parse: fMP4 media lists its EXT-X-MAP and segment URIs, query dropped', () => {
  const p = parsePlaylist(FMP4_MEDIA, 'https://h.example/p/v/index.m3u8');
  assert.equal(p.durationSeconds, 10);
  assert.deepEqual(p.resourceUrls, ['https://h.example/p/v/fragmented.mp4']);
  const m = parsePlaylist(FMP4_MASTER, BASE);
  assert.equal(masterHasAudio(m), true);
  assert.equal(pickVariant(m).height, 720);
});

test('classifyCaptures: .mp4 captures that are fMP4 segments are reported, via the captured media playlist', async () => {
  const { srv, base } = await serve((req, res) => {
    const path = req.url.split('?')[0];
    res.end(path.endsWith('/master.m3u8') ? FMP4_MASTER : FMP4_MEDIA);
  });
  try {
    const out = await classifyCaptures([
      { url: `${base}/p/master.m3u8`, headers: [] },
      { url: `${base}/p/v/index.m3u8`, headers: [] },
      { url: `${base}/p/v/fragmented.mp4?sig=zzz`, headers: [] },
      { url: `${base}/p/other/lecture.mp4`, headers: [] },
    ]);
    assert.deepEqual(out.segments, [`${base}/p/v/fragmented.mp4?sig=zzz`]);
    assert.equal(out.streams.length, 1);
    assert.equal(out.streams[0].hasAudio, true);
    assert.equal(out.streams[0].durationSeconds, 10);
    assert.equal(out.streams[0].estimatedBytes, 2_500_000);
  } finally {
    srv.close();
  }
});

test('classifyCaptures: a master alone is enough to place its fMP4 segment captures', async () => {
  const { srv, base } = await serve((req, res) => {
    const path = req.url.split('?')[0];
    res.end(path.endsWith('/master.m3u8') ? FMP4_MASTER : FMP4_MEDIA);
  });
  try {
    const out = await classifyCaptures([
      { url: `${base}/p/master.m3u8`, headers: [] },
      { url: `${base}/p/a/fragmented.mp4`, headers: [] },
    ]);
    assert.deepEqual(out.segments, [`${base}/p/a/fragmented.mp4`]);
  } finally {
    srv.close();
  }
});

test('classifyCaptures: segment lookups are deduped, capped for the whole request, and stop once matched', async () => {
  const variants = (n) =>
    '#EXTM3U\n' +
    Array.from(
      { length: n },
      (_, i) => `#EXT-X-STREAM-INF:BANDWIDTH=${1000 + i}\nv${i}/index.m3u8\n`,
    ).join('');
  const hits = [];
  const { srv, base } = await serve((req, res) => {
    const path = req.url.split('?')[0];
    if (path.endsWith('/master.m3u8')) return res.end(variants(30));
    hits.push(path);
    res.end(path.includes('/v1/') ? FMP4_MEDIA : MEDIA);
  });
  try {
    const masters = Array.from({ length: 10 }, (_, i) => ({
      url: `${base}/m${i}/master.m3u8`,
      headers: [],
    }));
    // unmatched: every lookup runs, but only up to the cap (the estimates add one fetch per master)
    await classifyCaptures([...masters, { url: `${base}/nowhere/x.mp4`, headers: [] }]);
    assert.ok(hits.length <= MAX_MEDIA_LOOKUPS + masters.length, `${hits.length} fetches`);
    assert.equal(new Set(hits.slice(0, MAX_MEDIA_LOOKUPS)).size, MAX_MEDIA_LOOKUPS);

    // matched in the first batch: no further batches
    hits.length = 0;
    const out = await classifyCaptures([
      { url: `${base}/m0/master.m3u8`, headers: [] },
      { url: `${base}/m0/v1/fragmented.mp4`, headers: [] },
    ]);
    assert.deepEqual(out.segments, [`${base}/m0/v1/fragmented.mp4`]);
    assert.ok(hits.length <= 5, `${hits.length} fetches`);
  } finally {
    srv.close();
  }
});
