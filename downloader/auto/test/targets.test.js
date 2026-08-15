// The pure halves of /resolve: strategy → server/'s downloader key, and cap → wire target.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolFor, toTarget } from '../src/core/targets.js';

test('browser-capture strategies replay their headers via curl', () => {
  assert.equal(toolFor('videostream'), 'curl');
  assert.equal(toolFor('zoom'), 'curl');
});

test('the browserless strategies map to fetch / ytdlp', () => {
  assert.equal(toolFor('moodle-file'), 'fetch');
  assert.equal(toolFor('youtube-playlist'), 'ytdlp');
});

test('a Drive file routes on the media the probe resolved', () => {
  assert.equal(toolFor('google-drive', 'video'), 'ytdlp');
  assert.equal(toolFor('google-drive', 'material'), 'fetch');
});

// The array shape is load-bearing: server/'s curl iterates it as `[{name, value}]`, the same
// shape the extension's webRequest capture produces.
test('a curl target carries its captured headers as a name/value array', () => {
  const headers = [
    { name: 'Cookie', value: 'a=b' },
    { name: 'Referer', value: 'https://host/' },
  ];
  assert.deepEqual(
    toTarget({
      name: 'L1',
      cap: { url: 'https://host/v.mp4', headers },
      tool: 'curl',
      fromCache: true,
    }),
    {
      name: 'L1',
      tool: 'curl',
      url: 'https://host/v.mp4',
      headers,
      fromCache: true,
    },
  );
});

test('a non-curl target is url-only — nothing replays headers there', () => {
  const cap = { url: 'https://youtu.be/x', headers: [{ name: 'Cookie', value: 'a=b' }] };
  assert.deepEqual(toTarget({ name: 'L2', cap, tool: 'ytdlp', fromCache: false }), {
    name: 'L2',
    tool: 'ytdlp',
    url: 'https://youtu.be/x',
    fromCache: false,
  });
});

test('a headerless curl cap still ships an iterable headers array, and fromCache is a bool', () => {
  const target = toTarget({ name: 'L3', cap: { url: 'https://h/v.mp4' }, tool: 'curl' });
  assert.deepEqual(target.headers, []);
  assert.equal(target.fromCache, false);
});
