// The shared extension → media table every probe routes on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFilename, filenameFromDisposition } from '../src/lib/fileMedia.js';

test('extension classification', () => {
  for (const name of ['a.mp4', 'a.MKV', 'a.mov', 'a.webm', 'a.m4v', 'a.avi'])
    assert.equal(classifyFilename(name), 'video', name);
  for (const name of ['handout.pdf', 'L1.zip', 'slides.pptx', 'notes', 'code.tar.gz', null])
    assert.equal(classifyFilename(name), null, String(name));
});

test('a malformed RFC 5987 escape falls back to the plain filename', () => {
  assert.equal(
    filenameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="L9.pdf"`),
    'L9.pdf',
  );
  assert.equal(filenameFromDisposition(`attachment; filename*=UTF-8''%`), null);
});

test('audio detection by mimetype or extension', async () => {
  const { isAudioFile } = await import('../src/lib/fileMedia.js');
  assert.ok(isAudioFile('audio/mpeg', 'x'));
  assert.ok(isAudioFile('application/octet-stream', 'rec.M4A'));
  assert.ok(isAudioFile(undefined, 'a.opus'));
  assert.equal(isAudioFile('application/pdf', 'a.pdf'), false);
  assert.equal(isAudioFile('video/mp4', 'a.mp4'), false);
  assert.equal(isAudioFile(null, null), false);
});
