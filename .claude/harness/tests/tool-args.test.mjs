import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  FAILURES,
  fixtureFor,
  headerDump,
  onAuto,
  requestHeaders,
  urlArg,
  valueAfter,
} from '../fakes/tool-args.mjs';

describe('valueAfter', () => {
  test('the first flag listed wins, whatever the argv order', () => {
    const args = ['-o', 'short.mp4', '--output', 'long.mp4'];
    assert.equal(valueAfter(args, '--output', '-o'), 'long.mp4');
    assert.equal(valueAfter(args, '-o', '--output'), 'short.mp4');
  });

  test('falls through to the next flag when the first has no value', () => {
    assert.equal(valueAfter(['-o', 'a.mp4', '--output'], '--output', '-o'), 'a.mp4');
  });

  test('null when no flag is there', () => {
    assert.equal(valueAfter(['https://x/y.mp4'], '--output', '-o'), null);
  });
});

describe('urlArg', () => {
  test('the last http(s) argument wins', () => {
    const args = ['--referer', 'https://a/page', '-L', 'http://b/video.mp4'];
    assert.equal(urlArg(args), 'http://b/video.mp4');
  });

  test('non-URL arguments are never picked', () => {
    assert.equal(urlArg(['-o', 'out.mp4', 'ftp://x/y', 'httpsfoo']), '');
  });
});

describe('fixtureFor', () => {
  const dir = '/fixtures';
  const video = path.join(dir, 'video.mp4');
  const pdf = path.join(dir, 'handout.pdf');

  test('a .pdf path gets the PDF, in any case', () => {
    assert.equal(fixtureFor('https://s/pluginfile.php/1/handout-01.pdf', dir), pdf);
    assert.equal(fixtureFor('https://s/files/NOTES.PDF', dir), pdf);
  });

  test('a PDF named only in the query is still the video', () => {
    assert.equal(fixtureFor('https://s/get?file=a.pdf', dir), video);
  });

  test('anything else gets the video', () => {
    assert.equal(fixtureFor('https://s/media/lecture-01.mp4', dir), video);
    assert.equal(fixtureFor('not a url', dir), video);
    assert.equal(fixtureFor('', dir), video);
  });
});

describe('FAILURES', () => {
  test('each failure has curl’s and yt-dlp’s exit code', () => {
    const codes = Object.fromEntries(
      Object.entries(FAILURES).map(([kind, tools]) => [
        kind,
        { curl: tools.curl[0], 'yt-dlp': tools['yt-dlp'][0] },
      ]),
    );
    assert.deepEqual(codes, {
      404: { curl: 22, 'yt-dlp': 1 },
      403: { curl: 22, 'yt-dlp': 1 },
      drop: { curl: 18, 'yt-dlp': 1 },
    });
  });

  test('curl names the status its code stands for', () => {
    assert.match(FAILURES[404].curl[1], /^curl: \(22\) .*404$/);
    assert.match(FAILURES[403].curl[1], /^curl: \(22\) .*403$/);
    assert.match(FAILURES.drop.curl[1], /^curl: \(18\) /);
  });
});

describe('onAuto', () => {
  test("only a /moodle/file/ path is auto's", () => {
    assert.equal(onAuto('http://127.0.0.1:4000/moodle/file/abc'), true);
    assert.equal(onAuto('https://lemida.biu.ac.il/deny/lecture-07.mp4'), false);
    assert.equal(onAuto(''), false);
  });
});

describe('requestHeaders', () => {
  test('reads inline -H values and @file ones', () => {
    const files = { 'h.txt': 'X-Secret: s3\nX-Wait: 1\n' };
    const args = ['-H', '@h.txt', '--header', 'Range: bytes=5-', '-L', 'http://a/b'];
    assert.deepEqual(
      requestHeaders(args, (f) => files[f]),
      {
        'X-Secret': 's3',
        'X-Wait': '1',
        Range: 'bytes=5-',
      },
    );
  });

  test('none without -H', () => {
    assert.deepEqual(
      requestHeaders(['-L', 'http://a/b'], () => ''),
      {},
    );
  });
});

describe('headerDump', () => {
  test("a status line curl's parsers read, then the headers", () => {
    const dump = headerDump(403, [['content-type', 'application/json']]);
    assert.equal(dump, 'HTTP/1.1 403\r\ncontent-type: application/json\r\n\r\n');
    assert.match(dump, /^HTTP\/\S+\s+(\d{3})/m);
  });
});
