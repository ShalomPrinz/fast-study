import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { assignmentDoc, describeCall, partsOf, promptHeads } from '../fakes/assignment-calls.mjs';
import { createRules } from '../fakes/provider-rules.mjs';

const DIR = new URL('../../../backend/assets/instructions', import.meta.url).pathname;
const heads = promptHeads(DIR, (file) => fs.readFileSync(file, 'utf8'));
const text = (value) => ({ text: value });
const prompt = (doc) => fs.readFileSync(`${DIR}/assignment_${doc}.md`, 'utf8');

describe('assignmentDoc', () => {
  test('reads each head from the backend prompt files', () => {
    assert.match(heads.intuition, /^# Assignment Intuition/);
    assert.match(heads.solution, /^# Assignment Full Solution/);
  });
  test('matches on the last text part', () => {
    for (const doc of ['intuition', 'solution']) {
      const parts = [text('--- INSTRUCTIONS ---'), text(prompt(doc))];
      assert.equal(assignmentDoc(parts, heads), doc);
    }
  });
  test('a summarize call is not one', () => {
    const parts = [text('--- TRANSCRIPT ---'), text('# Summarize this lecture')];
    assert.equal(assignmentDoc(parts, heads), null);
  });
  test('the prompt must be last, not merely present', () => {
    assert.equal(assignmentDoc([text(prompt('solution')), text('later')], heads), null);
  });
  test('no text part', () => assert.equal(assignmentDoc([{ fileData: {} }], heads), null));
});

describe('describeCall', () => {
  test('lists file mimes and summaries', () => {
    const body = {
      contents: [
        {
          parts: [
            text('--- ASSIGNMENT DOCUMENTS ---'),
            { fileData: { mimeType: 'application/pdf', fileUri: 'u' } },
            { fileData: { mimeType: 'text/plain', fileUri: 'u2' } },
            text('--- COURSE LECTURE SUMMARIES ---'),
            text('<lecture kind="lecture" title="שיעור 1"># sum</lecture>'),
          ],
        },
        { parts: [text('--- INSTRUCTIONS ---'), text(prompt('intuition'))] },
      ],
    };
    const call = describeCall('intuition', partsOf(body));
    assert.deepEqual(call.files, ['application/pdf', 'text/plain']);
    assert.deepEqual(
      call.summaries.map(({ kind, title }) => ({ kind, title })),
      [{ kind: 'lecture', title: 'שיעור 1' }],
    );
  });
});

describe('rule scoping to assignment calls', () => {
  // The shim stamps an assignment's calls `course/Assignments/name`.
  const stamp = (course, name) =>
    encodeURIComponent(`${course}/Assignments/${name}`).replace(/%2F/g, '/');
  test('match "Assignments" hits them and no lecture or overview call', () => {
    const rules = createRules();
    rules.control({ gemini: { mode: '500', match: 'Assignments' } });
    const ok = ['500'];
    assert.equal(rules.take('gemini', stamp('hb-edit', 'תרגיל 1'), ok).hit, '500');
    assert.equal(rules.take('gemini', 'hb-edit/שיעור 1', ok).hit, 'ok');
    assert.equal(rules.take('gemini', 'hb-edit/Recitations/r1', ok).hit, 'ok');
    assert.equal(rules.take('gemini', 'hb-edit', ok).hit, 'ok');
  });
  test('a lecture rule does not hit an assignment of the same course', () => {
    const rules = createRules();
    rules.control({ gemini: { mode: '500', match: 'hb-edit/שיעור 1' } });
    assert.equal(rules.take('gemini', stamp('hb-edit', 'תרגיל 1'), ['500']).hit, 'ok');
  });
});
