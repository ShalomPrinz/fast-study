// Every discovery Item says whether acting on it reaches Moodle, so the frontend gates only those
// rows; the answer is each extractor's own, and no extractor may ship without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-moodleflag-'));
process.env.FASTSTUDY_STATE_DIR = STATE_DIR;
process.on('exit', () => fs.rmSync(STATE_DIR, { recursive: true, force: true }));
import { extractors, reachesMoodle } from '../src/core/registry.js';
import { VideoExtractor } from '../src/extractors/VideoExtractor.js';
import { setCurrentSite } from '../src/moodle/site.js';
import { cacheProbe } from '../src/core/probeCache.js';
import { writeTokenFile } from '../src/auth/tokenStore.js';
import { handleList } from '../src/http/server.js';
import './gated.js';

const SITE = 'https://moodle.test';
setCurrentSite(SITE);

test('every registered extractor answers reachesMoodle itself', () => {
  for (const extractor of extractors()) {
    assert.notEqual(
      extractor.reachesMoodle,
      VideoExtractor.prototype.reachesMoodle,
      `${extractor.constructor.name} must override reachesMoodle`,
    );
  }
});

test('an extractor that does not answer cannot be asked', () => {
  class Silent extends VideoExtractor {}
  assert.throws(() => new Silent().reachesMoodle({}), /does not say whether it reaches Moodle/);
});

test('each strategy answers for itself', () => {
  const cases = [
    [{ strategy: 'moodle-file', fileurl: `${SITE}/webservice/pluginfile.php/1/a.pdf` }, true],
    [{ strategy: 'videostream', pageUrl: `${SITE}/mod/videostream/view.php?id=1` }, true],
    [{ strategy: 'zoom', pageUrl: 'https://zoom.us/rec/share/abc' }, false],
    [{ strategy: 'youtube-playlist', pageUrl: 'https://www.youtube.com/playlist?list=x' }, false],
    [{ strategy: 'youtube-playlist', url: 'https://www.youtube.com/watch?v=1' }, false],
    [{ strategy: 'google-drive', pageUrl: 'https://drive.google.com/file/d/abc/view' }, false],
    [{ strategy: 'direct-url', pageUrl: `${SITE}/media/lecture.mp4` }, true],
    [{ strategy: 'direct-url', pageUrl: 'https://cdn.test/lecture.mp4' }, false],
  ];
  for (const [recording, expected] of cases) {
    assert.equal(reachesMoodle(recording), expected, `${recording.strategy} ${recording.pageUrl}`);
  }
});

test('an off-site link reaches Moodle once the probe saw it redirect there', () => {
  const recording = { strategy: 'direct-url', pageUrl: 'https://short.test/r1' };
  assert.equal(reachesMoodle(recording), false);
  cacheProbe('https://short.test/r1', 'video', 'a.mp4', undefined, `${SITE}/media/a.mp4`);
  assert.equal(reachesMoodle(recording), true);
});

test('every listed Item carries the flag', async (t) => {
  writeTokenFile(path.join(STATE_DIR, 'auth', 'moodle-token.json'), {
    site: SITE,
    wstoken: 'w',
    userid: 7,
  });
  const sections = [
    {
      name: 'Lectures',
      modules: [
        {
          modname: 'resource',
          name: 'Notes',
          url: `${SITE}/mod/resource/view.php?id=1`,
          contents: [
            {
              type: 'file',
              filename: 'n.pdf',
              mimetype: 'application/pdf',
              fileurl: `${SITE}/webservice/pluginfile.php/1/n.pdf`,
            },
          ],
        },
        {
          modname: 'url',
          name: 'Recording',
          url: `${SITE}/mod/url/view.php?id=2`,
          contents: [{ fileurl: 'https://www.youtube.com/playlist?list=x' }],
        },
      ],
    },
  ];
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => sections,
  }));
  const res = { status: (c) => ((res.code = c), res), json: (b) => (res.body = b), on() {} };
  await handleList({ body: { courseUrl: `${SITE}/course/view.php?id=5` }, headers: {} }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(
    res.body.items.map((i) => [i.title, i.moodle]),
    [
      ['Notes', true],
      ['Recording', false],
    ],
  );
});
