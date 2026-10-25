import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { COURSE_FILES, OVERSIZE_BYTES, minimalPptx, oversizePdf } from '../lib/course-files.mjs';
import { zip } from '../lib/zip.mjs';

function list(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  const file = path.join(dir, 'a.zip');
  fs.writeFileSync(file, buf);
  try {
    return execFileSync('python3', [
      '-I',
      '-c',
      'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("\\n".join(z.namelist()))',
      file,
    ])
      .toString()
      .trim()
      .split('\n');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

test('the zip writer makes an archive Python reads back intact', () => {
  assert.deepEqual(list(zip({ 'a.txt': 'x', 'b/c.bin': Buffer.from([1, 2]) })), [
    'a.txt',
    'b/c.bin',
  ]);
});

test('the pptx fixture is a zip with the parts a reader needs', () => {
  const names = list(minimalPptx());
  assert.ok(names.includes('[Content_Types].xml') && names.includes('ppt/slides/slide1.xml'));
});

test('the oversize pdf passes the 10 MB limit and still starts as a pdf', () => {
  const big = oversizePdf(Buffer.from('%PDF-1.4\n'));
  assert.ok(big.length > 10 * 1024 * 1024 && big.length > OVERSIZE_BYTES);
  assert.equal(big.subarray(0, 5).toString(), '%PDF-');
});

test('every served file names how it is made', () => {
  for (const [name, file] of Object.entries(COURSE_FILES))
    assert.ok(file.mime && (file.build || file.from), name);
});
