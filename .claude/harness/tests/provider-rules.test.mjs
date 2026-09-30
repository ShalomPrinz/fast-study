import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OK, createRules, parseRule } from '../fakes/provider-rules.mjs';

// The header as the shim stamps it: percent-encoded, slashes kept.
const header = (lecture) => lecture.split('/').map(encodeURIComponent).join('/');
const ALL = ['429', '500', 'empty', 'slow', 'invalidkey'];

describe('parseRule', () => {
  test('a bare string is the untargeted rule', () => {
    assert.deepEqual(parseRule('gemini', '429'), { ...OK, mode: '429' });
  });

  test('an object keeps its fields', () => {
    const rule = { mode: 'slow', match: 'c/l', times: 2, ms: 50 };
    assert.deepEqual(parseRule('groq', rule), rule);
  });

  const rejections = [
    [
      'an unknown field',
      'groq',
      { mode: '429', lecture: 'x' },
      /takes mode, match, times, ms — not lecture/,
    ],
    ['an empty match', 'groq', { mode: '429', match: '' }, /match must be a non-empty path/],
    ['a non-string match', 'groq', { mode: '429', match: 4 }, /match must be a non-empty path/],
    ['an unknown mode', 'groq', 'teapot', /groq mode must be one of ok \| 429/],
    ['a mode only the other provider has', 'groq', 'invalidkey', /groq mode must be one of/],
    ['times 0', 'gemini', { mode: '500', times: 0 }, /times must be a whole number ≥ 1/],
    ['fractional times', 'gemini', { mode: '500', times: 1.5 }, /times must be a whole number/],
    ['string times', 'gemini', { mode: '500', times: '2' }, /times must be a whole number/],
    ['slow without ms', 'gemini', 'slow', /ms is a whole number ≥ 1, given with mode slow/],
    ['slow with ms 0', 'gemini', { mode: 'slow', ms: 0 }, /ms is a whole number/],
    ['ms without slow', 'gemini', { mode: '429', ms: 100 }, /only with it/],
  ];
  for (const [name, provider, value, message] of rejections) {
    test(`rejects ${name}`, () => assert.throws(() => parseRule(provider, value), message));
  }
});

describe('take — whole-segment matching', () => {
  const hitFor = (match, lecture) => {
    const rules = createRules();
    rules.control({ gemini: { mode: '429', match } });
    return rules.take('gemini', lecture === undefined ? undefined : header(lecture), ALL).hit;
  };

  test('a course matches every lecture under it', () => {
    assert.equal(hitFor('hb-fail', 'hb-fail/שיעור 4'), '429');
  });

  test('a lecture name matches it in any course', () => {
    assert.equal(hitFor('שיעור 4', 'hb-fail/שיעור 4'), '429');
    assert.equal(hitFor('שיעור 4', 'other/שיעור 4'), '429');
  });

  test('a lecture name never matches a longer one', () => {
    assert.equal(hitFor('שיעור 4', 'hb-fail/שיעור 40'), 'ok');
    assert.equal(hitFor('hb-fail/שיעור 4', 'hb-fail/שיעור 40'), 'ok');
    assert.equal(hitFor('hb', 'hb-fail/שיעור 4'), 'ok');
  });

  test('a recitation path matches whole and by its name', () => {
    assert.equal(hitFor('c/Recitations/תרגול 1', 'c/Recitations/תרגול 1'), '429');
    assert.equal(hitFor('תרגול 1', 'c/Recitations/תרגול 1'), '429');
    assert.equal(hitFor('c/תרגול 1', 'c/Recitations/תרגול 1'), 'ok');
  });

  test('a header-less probe is reached only by an untargeted rule', () => {
    assert.equal(hitFor('hb-fail', undefined), 'ok');
    const rules = createRules();
    rules.control({ gemini: '429' });
    assert.equal(rules.take('gemini', undefined, ALL).hit, '429');
  });
});

describe('take — draining and honoured modes', () => {
  test('times drains one per failed call, back to ok at zero', () => {
    const rules = createRules();
    rules.control({ groq: { mode: '500', times: 2 } });
    assert.equal(rules.take('groq', undefined, ALL).hit, '500');
    assert.equal(rules.mode.groq.times, 1);
    assert.equal(rules.take('groq', undefined, ALL).hit, '500');
    assert.deepEqual(rules.mode.groq, OK);
    assert.equal(rules.take('groq', undefined, ALL).hit, 'ok');
  });

  test('a call the rule does not match does not drain it', () => {
    const rules = createRules();
    rules.control({ groq: { mode: '500', match: 'c/a', times: 1 } });
    assert.equal(rules.take('groq', header('c/b'), ALL).hit, 'ok');
    assert.equal(rules.mode.groq.times, 1);
    assert.equal(rules.take('groq', header('c/a'), ALL).hit, '500');
    assert.deepEqual(rules.mode.groq, OK);
  });

  test('a mode outside the route’s honoured list answers ok without draining', () => {
    const rules = createRules();
    rules.control({ gemini: { mode: '429', times: 1 } });
    assert.equal(rules.take('gemini', undefined, ['500']).hit, 'ok');
    assert.equal(rules.mode.gemini.times, 1);
  });

  test('a slow hit carries its ms, also on the call that drains it', () => {
    const rules = createRules();
    rules.control({ gemini: { mode: 'slow', ms: 250, times: 1 } });
    assert.deepEqual(rules.take('gemini', undefined, ALL), { hit: 'slow', ms: 250 });
    assert.deepEqual(rules.mode.gemini, OK);
  });
});

describe('control', () => {
  test('a provider field sets only that provider', () => {
    const rules = createRules();
    rules.control({ groq: '429' });
    rules.control({ gemini: '500' });
    assert.equal(rules.mode.groq.mode, '429');
    assert.equal(rules.mode.gemini.mode, '500');
  });

  test('reset clears both, and a field beside it applies on top', () => {
    const rules = createRules();
    rules.control({ groq: '429', gemini: '500' });
    rules.control({ reset: true, gemini: 'empty' });
    assert.deepEqual(rules.mode.groq, OK);
    assert.equal(rules.mode.gemini.mode, 'empty');
  });

  test('a bad rule changes neither provider', () => {
    const rules = createRules();
    rules.control({ groq: '429' });
    assert.throws(() => rules.control({ groq: '500', gemini: 'teapot' }));
    assert.equal(rules.mode.groq.mode, '429');
    assert.deepEqual(rules.mode.gemini, OK);
  });
});
