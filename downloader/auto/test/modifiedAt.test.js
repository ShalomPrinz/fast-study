import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRecordings } from '../src/core/core.js';
import { decodeRef, encodeRef } from '../src/lib/ref.js';

const list = (sections) => listRecordings(sections, '1');

test('single-file resource carries its file time in ms', () => {
  const [r] = list([
    {
      name: 'Slides',
      modules: [
        {
          modname: 'resource',
          name: 'Deck',
          contents: [
            {
              type: 'file',
              filename: 'a.pdf',
              fileurl: 'https://m/a.pdf',
              mimetype: 'application/pdf',
              timemodified: 1700000000,
            },
          ],
        },
      ],
    },
  ]);
  assert.equal(r.modifiedAt, 1700000000000);
});

test('multi-file resource uses each file own time', () => {
  const file = (n, t) => ({
    type: 'file',
    filename: n,
    fileurl: `https://m/${n}`,
    mimetype: 'application/pdf',
    timemodified: t,
  });
  const rows = list([
    {
      name: 'S',
      modules: [
        {
          modname: 'resource',
          name: 'D',
          contentsinfo: { lastmodified: 5 },
          contents: [file('a.pdf', 100), file('b.pdf', 200)],
        },
      ],
    },
  ]);
  assert.deepEqual(
    rows.map((r) => r.modifiedAt),
    [100000, 200000],
  );
});

test('url module falls back to contentsinfo.lastmodified', () => {
  const [r] = list([
    {
      name: 'S',
      modules: [
        {
          modname: 'url',
          name: 'Rec',
          contentsinfo: { lastmodified: 1600000000 },
          contents: [{ fileurl: 'https://www.youtube.com/playlist?list=PL1' }],
        },
      ],
    },
  ]);
  assert.equal(r.modifiedAt, 1600000000000);
});

test('modifiedAt stays out of the ref; zoom-summary row has none', () => {
  const [r] = list([
    {
      name: 'S',
      modules: [
        {
          modname: 'url',
          name: 'Rec',
          contents: [
            { fileurl: 'https://www.youtube.com/playlist?list=PL1', timemodified: 1600000000 },
          ],
        },
      ],
    },
  ]);
  assert.equal(r.modifiedAt, 1600000000000);
  assert.equal('modifiedAt' in decodeRef(encodeRef(r)), false);
  const zoom = list([
    {
      name: 'הקלטות',
      modules: [],
      summary: '<p>https://biu-ac-il.zoom.us/rec/share/abc <br>Passcode: x1</p>',
    },
  ]);
  assert.equal(zoom.length, 1);
  assert.equal(zoom[0].modifiedAt, undefined);
});
