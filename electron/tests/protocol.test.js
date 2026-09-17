const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

require('./stubElectron');
const { resolveWithin } = require('../protocol');

let parent;
let root;

before(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-bundle-'));
  root = path.join(parent, 'dist');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), '');
  // The sibling the `root + path.sep` half of the containment check exists for.
  fs.mkdirSync(path.join(parent, 'dist-evil'));
  fs.writeFileSync(path.join(parent, 'dist-evil', 'app.js'), '');
});

after(() => fs.rmSync(parent, { recursive: true, force: true }));

test('resolves a file at the bundle root', () => {
  assert.equal(resolveWithin(root, '/index.html'), path.join(root, 'index.html'));
});

test('resolves a nested file', () => {
  assert.equal(resolveWithin(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'));
});

test('resolves the root itself', () => {
  assert.equal(resolveWithin(root, '/'), root);
});

test('refuses a literal ../ escape', () => {
  assert.equal(resolveWithin(root, '/../index.html'), null);
});

test('refuses an escape hidden behind encoded slashes', () => {
  // What the URL parser really leaves intact: `app://bundle/..%2f..%2fetc/passwd`.
  assert.equal(decodeURIComponent('/..%2f..%2fetc/passwd'), '/../../etc/passwd');
  assert.equal(resolveWithin(root, '/..%2f..%2fetc/passwd'), null);
});

test('refuses a malformed percent-escape instead of throwing', () => {
  assert.equal(resolveWithin(root, '/%zz'), null);
});

test('refuses a sibling directory whose name starts with the root', () => {
  assert.equal(resolveWithin(root, '/../dist-evil/app.js'), null);
});
