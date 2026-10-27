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
import { classifyCaptures } from '../src/services/hls.js';
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
