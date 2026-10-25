import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyKind } from '../src/discovery/moodleCourse.js';

test('a recitation keyword makes a recitation; an exercise title alone does not', () => {
  for (const title of ['תרגול 3', 'תרגולים', 'Recitation 2', 'Tirgul 1'])
    assert.equal(classifyKind('', title), 'recitation', title);
  assert.equal(classifyKind('', 'תרגיל 3'), 'lecture');
});
