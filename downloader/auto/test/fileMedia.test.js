// The shared extension → media table every probe routes on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFilename, filenameFromDisposition } from '../src/lib/fileMedia.js';

test('extension classification', () => {
  for (const name of ['a.mp4', 'a.MKV', 'a.mov', 'a.webm', 'a.m4v', 'a.avi'])
    assert.equal(classifyFilename(name), 'video', name);
  assert.equal(classifyFilename('handout.pdf'), 'material');
  for (const name of ['L1.zip', 'slides.pptx', 'notes', 'code.tar.gz', null])
    assert.equal(classifyFilename(name), null, String(name));
});

test('a malformed RFC 5987 escape falls back to the plain filename', () => {
  assert.equal(
    filenameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="L9.pdf"`),
    'L9.pdf',
  );
  assert.equal(filenameFromDisposition(`attachment; filename*=UTF-8''%`), null);
});
