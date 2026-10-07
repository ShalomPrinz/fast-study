import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { wrapFetchError } from '../lib/api.mjs';
import { containsFixtureParagraph, fixtureParagraphs, paragraphsOf } from '../lib/fixture.mjs';

describe('fixture paragraphs', () => {
  test('splits on blank lines', () => {
    assert.deepEqual(paragraphsOf('a\n\nb\n \n\nc\n'), ['a', 'b', 'c\n']);
  });
  test('any one paragraph is accepted, wrong text is not', () => {
    const paragraphs = fixtureParagraphs();
    assert.ok(paragraphs.length > 1);
    assert.ok(containsFixtureParagraph(`x ${paragraphs[2].trim()} y`, paragraphs));
    assert.ok(!containsFixtureParagraph('something else entirely', paragraphs));
  });
});

describe('wrapFetchError', () => {
  test('names the method, url and cause', () => {
    const error = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    const wrapped = wrapFetchError('GET', 'http://127.0.0.1:1/x', error);
    assert.match(wrapped.message, /GET http:\/\/127\.0\.0\.1:1\/x/);
    assert.match(wrapped.message, /ECONNREFUSED/);
    assert.equal(wrapped.cause, error);
  });
  test('works without a cause', () => {
    assert.match(wrapFetchError('GET', 'u', new Error('boom')).message, /boom/);
  });
});
