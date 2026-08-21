// The pure halves of the Drive filename probe: URL → file id, response → filename.
// The fetch itself is exercised against the real endpoint, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driveFileId,
  driveDownloadUrl,
  filenameFromDisposition,
  filenameFromHtml,
  probeDriveFile,
} from '../src/extractors/GoogleDriveExtractor.js';
import { getDriveMedia } from '../src/core/driveProbeCache.js';

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

// Stand in for Drive over the probe's whole request chain: `disposition` null + empty bodies is
// the unshared file. Returns the call counter so a test can assert a cache hit did no I/O.
function stubFetch(disposition) {
  const calls = { n: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.n += 1;
    return {
      headers: { get: () => disposition },
      body: { cancel: async () => {} },
      text: async () => '',
    };
  };
  calls.restore = () => {
    globalThis.fetch = real;
  };
  return calls;
}

test('an unshared file is memoized and re-thrown from cache with no request', async (t) => {
  const id = 'unshared-file-id';
  const url = `https://drive.google.com/file/d/${id}/view`;
  const calls = stubFetch(null);
  t.after(calls.restore);

  await assert.rejects(probeDriveFile(url), /not publicly shared.*unshared-file-id/s);
  assert.ok(calls.n > 0);
  assert.equal(getDriveMedia(id), null); // /list stamps this row 'unsupported'

  const before = calls.n;
  await assert.rejects(probeDriveFile(url), /not publicly shared.*unshared-file-id/s);
  assert.equal(calls.n, before);
});

test('a .zip round-trips from cache with its filename', async (t) => {
  const id = 'zip-file-id';
  const url = `https://drive.google.com/file/d/${id}/view`;
  const calls = stubFetch('attachment; filename="L1.zip"');
  t.after(calls.restore);

  const first = await probeDriveFile(url);
  assert.deepEqual(
    { filename: first.filename, media: first.media },
    { filename: 'L1.zip', media: null },
  );

  const before = calls.n;
  const cached = await probeDriveFile(url);
  assert.equal(cached.filename, 'L1.zip');
  assert.equal(cached.media, null);
  assert.equal(calls.n, before);
});

test('a forced probe ignores a cached unshared verdict', async (t) => {
  const id = 'reshared-file-id';
  const url = `https://drive.google.com/file/d/${id}/view`;
  const unshared = stubFetch(null);
  await assert.rejects(probeDriveFile(url), /not publicly shared/);
  unshared.restore();

  const shared = stubFetch('attachment; filename="Lecture 1.mp4"');
  t.after(shared.restore);
  const probe = await probeDriveFile(url, { force: true });
  assert.equal(probe.filename, 'Lecture 1.mp4');
  assert.equal(probe.media, 'video');
  assert.equal(getDriveMedia(id), 'video');
});
