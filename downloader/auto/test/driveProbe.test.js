// The pure halves of the Drive filename probe: URL → file id, response → filename,
// filename → media. The fetch itself is exercised against the real endpoint, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driveFileId,
  driveDownloadUrl,
  filenameFromDisposition,
  filenameFromHtml,
  classifyDriveFilename,
} from '../src/extractors/GoogleDriveExtractor.js';

const ID = '1AbCdEf-GhIjKlMnOpQrStUvWxYz';

test('file id out of all three single-file URL shapes', () => {
  assert.equal(driveFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), ID);
  assert.equal(driveFileId(`https://docs.google.com/file/d/${ID}`), ID);
  assert.equal(driveFileId(`https://drive.google.com/open?id=${ID}`), ID);
  assert.equal(driveFileId(`https://drive.google.com/uc?export=download&id=${ID}`), ID);
});

test('no file id for folders, non-Drive hosts and junk', () => {
  assert.equal(driveFileId(`https://drive.google.com/drive/folders/${ID}`), null);
  assert.equal(driveFileId(`https://example.com/file/d/${ID}/view`), null);
  assert.equal(driveFileId('https://drive.google.com/open'), null);
  assert.equal(driveFileId(undefined), null);
});

test('direct-download URL', () => {
  assert.equal(driveDownloadUrl(ID), `https://drive.google.com/uc?export=download&id=${ID}`);
});

test('filename out of Content-Disposition', () => {
  assert.equal(filenameFromDisposition('attachment; filename="L1.zip"'), 'L1.zip');
  assert.equal(filenameFromDisposition('attachment; filename=L1.zip'), 'L1.zip');
  assert.equal(
    filenameFromDisposition(`attachment; filename="lecture.pdf"; filename*=UTF-8''%D7%902.mp4`),
    'א2.mp4',
  );
  assert.equal(filenameFromDisposition(null), null);
  assert.equal(filenameFromDisposition('inline'), null);
});

test('filename out of the confirm interstitial', () => {
  const uc = `<span class="uc-name-size"><a href="/open?id=${ID}">Lecture 4.mp4</a> (2.1G)</span>`;
  assert.equal(filenameFromHtml(uc), 'Lecture 4.mp4');
  const scan = '<p>L2.zip (140M) is too large for Google to scan for viruses.</p>';
  assert.equal(filenameFromHtml(scan), 'L2.zip');
});

test('filename out of the /view page title', () => {
  assert.equal(filenameFromHtml('<title>L1.zip - Google Drive</title>'), 'L1.zip');
  assert.equal(filenameFromHtml('<title>הרצאה 3.pdf - Google Drive</title>'), 'הרצאה 3.pdf');
});

test('a sign-in / error page yields no filename', () => {
  assert.equal(filenameFromHtml('<title>Meet Google Drive - Google Drive</title>'), null);
  assert.equal(filenameFromHtml('<title>Sign in - Google Accounts</title>'), null);
  assert.equal(filenameFromHtml(''), null);
});

test('extension classification', () => {
  for (const name of ['a.mp4', 'a.MKV', 'a.mov', 'a.webm', 'a.m4v', 'a.avi'])
    assert.equal(classifyDriveFilename(name), 'video', name);
  assert.equal(classifyDriveFilename('handout.pdf'), 'material');
  for (const name of ['L1.zip', 'slides.pptx', 'notes', 'code.tar.gz', null])
    assert.equal(classifyDriveFilename(name), null, String(name));
});
