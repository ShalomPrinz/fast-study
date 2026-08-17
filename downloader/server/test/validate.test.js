// `storedName` canonicalizes through a port of `database/fs/paths.py::safe_name`; these cases
// mirror `database/tests/test_paths.py` so a drift between the two shows up here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storedName } from '../src/validate.js';

test('drops windows-illegal characters', () => {
  assert.equal(storedName('שיעור 3: מבוא <א>'), 'שיעור 3 מבוא א');
});

test('strips trailing dots and spaces', () => {
  assert.equal(storedName('Intro. . '), 'Intro');
});

test('suffixes reserved device names, with an extension too', () => {
  assert.equal(storedName('CON'), 'CON_');
  assert.equal(storedName('com1.txt'), 'com1.txt_');
});

test('truncates to the max path budget', () => {
  assert.equal(storedName('א'.repeat(200)).length, 80);
});

test('is idempotent', () => {
  for (const name of ['שיעור 3: מבוא', 'CON', 'Intro. ', 'א'.repeat(200), 'Lecture 8.1']) {
    assert.equal(storedName(storedName(name)), storedName(name));
  }
});

// Where the Python raises: the routes turn the null into a 400.
test('answers null for a name with nothing legal left', () => {
  assert.equal(storedName(' ?? '), null);
});

// The segment check must run BEFORE canonicalizing, which strips '/' as an illegal character —
// otherwise 'a/b' would quietly become 'ab' instead of being rejected.
test('answers null for anything that is not one path segment', () => {
  for (const name of ['a/b', 'a\\b', '..', '.', '', undefined, 42]) {
    assert.equal(storedName(name), null);
  }
});
