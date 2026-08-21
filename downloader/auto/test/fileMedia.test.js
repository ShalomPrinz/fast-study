// The shared extension → media table every probe routes on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFilename } from '../src/lib/fileMedia.js';

test('extension classification', () => {
  for (const name of ['a.mp4', 'a.MKV', 'a.mov', 'a.webm', 'a.m4v', 'a.avi'])
    assert.equal(classifyFilename(name), 'video', name);
  assert.equal(classifyFilename('handout.pdf'), 'material');
  for (const name of ['L1.zip', 'slides.pptx', 'notes', 'code.tar.gz', null])
    assert.equal(classifyFilename(name), null, String(name));
});
