import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { minimalPdf } from '../lib/pdf.mjs';

test('the handout PDF opens in pypdf with its nested outline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const file = path.join(dir, 'a.pdf');
  fs.writeFileSync(file, minimalPdf());
  try {
    const script = [
      'import sys',
      'from pypdf import PdfReader',
      'r = PdfReader(sys.argv[1])',
      'o = r.outline',
      'print(len(r.pages), o[0].title, o[1][0].title)',
    ].join('\n');
    const out = execFileSync('uv', ['run', 'python3', '-I', '-c', script, file], {
      cwd: path.join(import.meta.dirname, '../../../backend'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(out.toString().trim(), '1 Summary Details');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
