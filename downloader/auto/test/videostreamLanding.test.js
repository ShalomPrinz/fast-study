// A module page rendered for anyone but the token's user (a guest, or anonymous) is logged out, read
// off core's M.cfg.userId right after the load, before the .mp4 wait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gated } from './gated.js';
import { VideostreamExtractor, notTheUser } from '../src/extractors/VideostreamExtractor.js';

const PAGE_URL = 'https://moodle.test/mod/videostream/view.php?id=1';
const MP4 = 'https://cdn.test/lecture.mp4';

// A page that lands where it was sent, rendered for `userId`; the .mp4 shows up only when `mp4`.
function fakePage(userId, { mp4 = false } = {}) {
  let landed = 'about:blank';
  return {
    url: () => landed,
    goto: async (u) => {
      landed = u;
    },
    evaluate: async (fn) => {
      globalThis.M = { cfg: { userId } };
      try {
        return fn();
      } finally {
        delete globalThis.M;
      }
    },
    // Never answering stands in for the 20 s wait: a test that reaches it times out.
    waitForRequest: () =>
      mp4
        ? Promise.resolve({ url: () => MP4, headers: () => ({}), response: async () => null })
        : new Promise(() => {}),
  };
}

const capture = (page, userid) =>
  gated(() =>
    new VideostreamExtractor().captureVideo(
      page,
      { title: 'L', pageUrl: PAGE_URL, strategy: 'videostream' },
      { userid },
    ),
  );

test(
  'a guest landing is videostream_login_required without waiting for the .mp4',
  { timeout: 2000 },
  async () => {
    const err = await capture(fakePage(1), 7).then(
      () => null,
      (e) => e,
    );
    assert.equal(err?.code, 'videostream_login_required');
    assert.deepEqual(err.params, { url: PAGE_URL });
  },
);

test("a page rendered for the token's user captures the .mp4 as before", async () => {
  const cap = await capture(fakePage(7, { mp4: true }), 7);
  assert.equal(cap.url, MP4);
});

test('anonymous is logged out; an unread M.cfg or no stored userid says nothing', () => {
  assert.equal(notTheUser(0, undefined), true);
  assert.equal(notTheUser(1, 7), true);
  assert.equal(notTheUser(7, 7), false);
  assert.equal(notTheUser(null, 7), false);
  assert.equal(notTheUser(1, undefined), false);
});
