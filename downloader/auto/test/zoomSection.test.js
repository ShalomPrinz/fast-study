import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZoomSummaries } from '../src/discovery/zoomSection.js';

const link = (id) => `<p dir="ltr">https://biu-ac-il.zoom.us/rec/share/${id}  <br>Passcode: x1</p>`;
const parse = (summary, name = 'הקלטות') =>
  parseZoomSummaries([{ name, summary }]).map(({ title, kind }) => ({ title, kind }));

const BIU_WEEK1 =
  '<p><strong>שבוע 1:</strong></p><p>הרצאה:</p>' +
  link('7aH9abc') +
  '<p>תרגול: </p>' +
  link('6UdEdef');

test('week heading + bare kind words title a lecture/recitation pair', () => {
  assert.deepEqual(parse(BIU_WEEK1), [
    { title: 'שבוע 1 – הרצאה', kind: 'lecture' },
    { title: 'שבוע 1 – תרגול', kind: 'recitation' },
  ]);
});

test('a new week heading clears the previous kind label', () => {
  const html =
    BIU_WEEK1 + '<p><strong>שבוע 2:</strong></p>' + link('w2a') + '<p>תרגול:</p>' + link('w2b');
  assert.deepEqual(parse(html).slice(2), [
    { title: 'שבוע 2', kind: 'lecture' },
    { title: 'שבוע 2 – תרגול', kind: 'recitation' },
  ]);
});

test('numbered labels keep their titles', () => {
  const html = '<p>הרצאה מספר 3:</p>' + link('n3') + '<p>תרגול 2 -</p>' + link('t2');
  assert.deepEqual(parse(html), [
    { title: 'הרצאה מספר 3', kind: 'lecture' },
    { title: 'תרגול 2', kind: 'recitation' },
  ]);
});

test('a numbered label under a week heading is not prefixed with the week', () => {
  const html =
    '<p>שבוע 2:</p><p>הרצאה מספר 3:</p>' + link('a3') + '<p>הרצאה מספר 4:</p>' + link('a4');
  assert.deepEqual(parse(html), [
    { title: 'הרצאה מספר 3', kind: 'lecture' },
    { title: 'הרצאה מספר 4', kind: 'lecture' },
  ]);
});

test('a short colon line before a link is the title as-is', () => {
  assert.deepEqual(parse('<p>חזרה למבחן:</p>' + link('rev')), [
    { title: 'חזרה למבחן', kind: 'lecture' },
  ]);
});

test('a colon line not followed by a link, or a long prose line, is no label', () => {
  const prose = 'בשיעור הזה נדבר על נושאים רבים ושונים ונסכם את החומר כולו כך:';
  const html = '<p>חומרים:</p><p>קישור לסילבוס</p>' + link('a') + `<p>${prose}</p>` + link('b');
  assert.deepEqual(parse(html), [
    { title: '', kind: 'lecture' },
    { title: '', kind: 'lecture' },
  ]);
});

test('English week heading + kind word', () => {
  const html = '<p><b>Week 2:</b></p><p>Recitation:</p>' + link('en');
  assert.deepEqual(parse(html, 'Recordings'), [
    { title: 'Week 2 – Recitation', kind: 'recitation' },
  ]);
});
