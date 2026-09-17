const assert = require('node:assert/strict');
const { test } = require('node:test');

const { MAILTO_LIMIT, cut, fitBody, mailtoUrl, pairedOnly } = require('../report');

const SUBJECT = 'FastStudy 0.1.0 error report';

test('a body that already fits comes back untouched', () => {
  const body = 'Route: /courses\nReport: C:\\report.txt';
  assert.equal(fitBody(SUBJECT, body), body);
});

test('a long Hebrew body is trimmed until the encoded URL fits', () => {
  // Hebrew is the case the binary search exists for: each character costs 6 characters encoded.
  const body = 'שגיאה בהרצת השיעור ';
  const long = body.repeat(400);

  const fitted = fitBody(SUBJECT, long);
  assert.ok(mailtoUrl(SUBJECT, fitted).length <= MAILTO_LIMIT);
  assert.ok(fitted.length < long.length);
  assert.ok(fitted.startsWith('שגיאה'));
  assert.ok(fitted.endsWith('[truncated — see the attached report]'));
});

test('a trimmed body never ends mid-surrogate-pair', () => {
  const fitted = fitBody(SUBJECT, '😀'.repeat(2000));

  assert.doesNotThrow(() => encodeURIComponent(fitted));
  assert.ok(mailtoUrl(SUBJECT, fitted).length <= MAILTO_LIMIT);
});

test('a cut on an odd boundary drops the orphaned half', () => {
  assert.equal(cut('😀😀', 3), '😀');
  assert.doesNotThrow(() => encodeURIComponent(cut('😀😀', 3)));
});

test('pairedOnly makes a lone surrogate encodable', () => {
  const lone = 'crashed on \uD83D';

  assert.throws(() => encodeURIComponent(lone), URIError);
  assert.doesNotThrow(() => encodeURIComponent(pairedOnly(lone)));
  assert.ok(pairedOnly(lone).startsWith('crashed on '));
});
