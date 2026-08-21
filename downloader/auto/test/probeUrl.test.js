// The generic two-tier probe. Tier 1 is pure; tier 2 runs against a stubbed fetch, so every
// test uses its own URL — the cache is process-lifetime by design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeUrl, probeKeyForUrl } from '../src/lib/probeUrl.js';
import { getProbedMedia } from '../src/core/probeCache.js';

// Stand in for the host. `headers` is a plain object; a null response body means the request threw.
function stubFetch(headers, { url, throws = false } = {}) {
  const calls = { n: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async (target) => {
    calls.n += 1;
    if (throws) throw new Error('ECONNREFUSED');
    return {
      ok: true,
      url: url ?? target,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      body: { cancel: async () => {} },
    };
  };
  calls.restore = () => {
    globalThis.fetch = real;
  };
  return calls;
}

test('probe key drops the fragment and nothing else', () => {
  assert.equal(probeKeyForUrl('https://x.test/a?b=1#frag'), 'https://x.test/a?b=1');
  assert.equal(probeKeyForUrl('not a url'), 'not a url');
});

test("the URL's own filename decides when the headers say nothing", async (t) => {
  const calls = stubFetch({});
  t.after(calls.restore);

  const video = await probeUrl('https://files.test/t1/lecture3.mp4');
  assert.deepEqual(
    { media: video.media, filename: video.filename },
    { media: 'video', filename: 'lecture3.mp4' },
  );
  const material = await probeUrl('https://files.test/t1/notes.pdf?v=2');
  assert.equal(material.media, 'material');
});

test('a login wall behind a .pdf URL is unsupported, not a material', async (t) => {
  // The corruption this guards: curl --fail sees 200 and would save the login page as material.pdf.
  const calls = stubFetch({ 'content-type': 'text/html; charset=utf-8' });
  t.after(calls.restore);

  const probe = await probeUrl('https://moodle.test/t12/syllabus.pdf');
  assert.deepEqual({ media: probe.media, certain: probe.certain }, { media: null, certain: true });
});

test('Content-Disposition names the file behind an opaque path', async (t) => {
  const calls = stubFetch({ 'content-disposition': 'attachment; filename="Lecture 4.mp4"' });
  t.after(calls.restore);

  const probe = await probeUrl('https://cdn.test/t2/download?id=77');
  assert.equal(probe.media, 'video');
  assert.equal(probe.filename, 'Lecture 4.mp4');
  assert.equal(calls.n, 1);
});

test('Content-Type decides when no disposition names the file', async (t) => {
  const calls = stubFetch({ 'content-type': 'application/pdf; charset=binary' });
  t.after(calls.restore);
  assert.equal((await probeUrl('https://cdn.test/t2b/asset')).media, 'material');
});

test('a share page (text/html) is an honest, remembered null', async (t) => {
  const calls = stubFetch({ 'content-type': 'text/html; charset=utf-8' });
  t.after(calls.restore);

  const probe = await probeUrl('https://dropbox.test/t3/s/abc');
  assert.equal(probe.media, null);
  assert.equal(getProbedMedia(probeKeyForUrl('https://dropbox.test/t3/s/abc')), null);
});

test('a real file this service cannot use is null, not a throw', async (t) => {
  const calls = stubFetch({ 'content-disposition': 'attachment; filename="L1.zip"' });
  t.after(calls.restore);

  const probe = await probeUrl('https://cdn.test/t4/bundle');
  assert.equal(probe.media, null);
  assert.equal(probe.filename, 'L1.zip');
});

test('a network failure is uncertain, never a throw and never cached', async (t) => {
  const url = 'https://offline.test/t5/whatever';
  const down = stubFetch({}, { throws: true });

  const probe = await probeUrl(url);
  assert.equal(probe.media, null);
  assert.equal(probe.filename, null);
  assert.equal(probe.certain, false);
  assert.equal(down.n, 2); // HEAD, then the ranged GET fallback
  // Nothing was remembered, so /list never greys the row and the next click probes again.
  assert.equal(getProbedMedia(probeKeyForUrl(url)), undefined);
  down.restore();

  const up = stubFetch({ 'content-disposition': 'attachment; filename="L5.mp4"' });
  t.after(up.restore);
  const retry = await probeUrl(url);
  assert.deepEqual(
    { media: retry.media, certain: retry.certain },
    { media: 'video', certain: true },
  );
});

test('a nameless generic-binary response is uncertain, not a permanent no', async (t) => {
  const url = 'https://cdn.test/t7/opaque';
  const calls = stubFetch({ 'content-type': 'application/octet-stream' });
  t.after(calls.restore);

  const probe = await probeUrl(url);
  assert.deepEqual({ media: probe.media, certain: probe.certain }, { media: null, certain: false });
  assert.equal(getProbedMedia(probeKeyForUrl(url)), undefined);
});

test('a named file is certain either way, even under a generic content type', async (t) => {
  const calls = stubFetch({
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename="L1.zip"',
  });
  t.after(calls.restore);

  const probe = await probeUrl('https://cdn.test/t8/bundle');
  assert.deepEqual({ media: probe.media, certain: probe.certain }, { media: null, certain: true });
  assert.equal(getProbedMedia(probeKeyForUrl('https://cdn.test/t8/bundle')), null);
});

test('an unusable filename beats a sloppy Content-Type', async (t) => {
  const calls = stubFetch({
    'content-disposition': 'attachment; filename="L1.zip"',
    'content-type': 'video/mp4',
  });
  t.after(calls.restore);

  const probe = await probeUrl('https://cdn.test/t11/bundle');
  assert.deepEqual({ media: probe.media, certain: probe.certain }, { media: null, certain: true });
});

test('a malformed RFC 5987 filename falls through instead of throwing', async (t) => {
  const calls = stubFetch({
    'content-disposition': `attachment; filename*=UTF-8''%E0%A4%A; filename="L9.pdf"`,
  });
  t.after(calls.restore);

  const probe = await probeUrl('https://cdn.test/t9/asset');
  assert.deepEqual(
    { media: probe.media, filename: probe.filename },
    {
      media: 'material',
      filename: 'L9.pdf',
    },
  );
});

test('a probe that never answers is aborted rather than hanging', async (t) => {
  const real = globalThis.fetch;
  let signals = 0;
  globalThis.fetch = async (_url, init) => {
    signals += init?.signal ? 1 : 0;
    throw new Error('aborted');
  };
  t.after(() => {
    globalThis.fetch = real;
  });

  await probeUrl('https://slow.test/t10/asset');
  assert.equal(signals, 2); // both attempts carry the timeout signal
});

test('a verdict is memoized, and force re-probes it', async (t) => {
  const url = 'https://cdn.test/t6/asset';
  const first = stubFetch({ 'content-type': 'text/html' });
  assert.equal((await probeUrl(url)).media, null);
  const before = first.n;
  assert.equal((await probeUrl(url)).media, null);
  assert.equal(first.n, before); // the cache answered
  first.restore();

  const second = stubFetch({ 'content-type': 'video/mp4' });
  t.after(second.restore);
  assert.equal((await probeUrl(url, { force: true })).media, 'video');
  assert.equal(getProbedMedia(probeKeyForUrl(url)), 'video');
});
