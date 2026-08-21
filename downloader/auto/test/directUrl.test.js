// The catch-all `url` extractor, and the registry order that keeps it a catch-all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectUrlExtractor } from '../src/extractors/DirectUrlExtractor.js';
import { resolveExtractor } from '../src/core/registry.js';

const direct = new DirectUrlExtractor();

// A recordings-section activity, so the routing tests aren't secretly reading the keyword gate.
function activity(externalUrl, modType = 'url') {
  return {
    modType,
    title: 'הקלטה 1',
    sectionName: 'הקלטות',
    externalUrl,
    viewUrl: 'https://moodle.test/mod/url/view.php?id=1',
    kind: 'lecture',
  };
}

test('claims any http(s) url module', () => {
  assert.ok(direct.canHandle(activity('https://files.test/a.mp4')));
  assert.ok(direct.canHandle(activity('http://files.test/opaque')));
});

test('does not claim a non-fetchable or non-url activity', () => {
  assert.equal(direct.canHandle(activity('mailto:teacher@uni.test')), false);
  assert.equal(direct.canHandle(activity('/local/path')), false);
  assert.equal(direct.canHandle(activity(undefined)), false);
  assert.equal(direct.canHandle(activity('https://files.test/a.mp4', 'resource')), false);
});

test('yields to the host-specific extractors', () => {
  assert.equal(
    resolveExtractor(activity('https://www.youtube.com/playlist?list=PL1')).strategy,
    'youtube-playlist',
  );
  assert.equal(
    resolveExtractor(activity('https://drive.google.com/file/d/abc123/view')).strategy,
    'google-drive',
  );
});

test('takes every other off-site link', () => {
  assert.equal(resolveExtractor(activity('https://files.test/L1.mp4')).strategy, 'direct-url');
  assert.equal(
    resolveExtractor(activity('https://www.dropbox.com/s/abc/L1?dl=0')).strategy,
    'direct-url',
  );
  // A Drive FOLDER is not a single file, so Drive passes and the catch-all lists it as unknown.
  assert.equal(
    resolveExtractor(activity('https://drive.google.com/drive/folders/abc123')).strategy,
    'direct-url',
  );
});

test('the keyword hint rides along without gating the claim', () => {
  const plain = { ...activity('https://files.test/L1.mp4'), title: 'סילבוס', sectionName: 'כללי' };
  assert.ok(direct.canHandle(plain));
  assert.equal(direct.toRecordings(plain)[0].likelyRecording, false);
});

test('a listed row is one unexpandable unknown target', () => {
  const [rec] = direct.toRecordings(activity('https://files.test/L1.mp4'));
  assert.deepEqual(rec, {
    title: 'הקלטה 1',
    pageUrl: 'https://files.test/L1.mp4',
    kind: 'lecture',
    strategy: 'direct-url',
    section: 'הקלטות',
    likelyRecording: true,
  });
});
