import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FIGURE_BOXES,
  boxReply,
  figureLines,
  figureSources,
  isBoxCall,
  placeFigures,
} from '../fakes/figure-calls.mjs';

const text = (t) => ({ text: t });

test('labelled FILE and PICTURE parts are the sources; unlabelled calls have none', () => {
  const parts = [
    text('FILE material.pdf (original file name: slides.pdf)'),
    text('FILE material.2.pptx'),
    text('PICTURE material.2.pptx#image1.png (on slide 1)'),
    text('summarize'),
  ];
  assert.deepEqual(figureSources(parts), {
    pdfs: ['material.pdf'],
    pictures: ['material.2.pptx#image1.png'],
  });
  assert.equal(figureSources([text('summarize')]), null);
});

test('links name the attached materials, and are placed after plain paragraphs only', () => {
  const lines = figureLines({ pdfs: ['material.pdf'], pictures: ['m.pptx#image1.png'] });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /\(material\.pdf#page=1\)$/);
  assert.match(lines[2], /\(m\.pptx#image1\.png\)$/);
  const out = placeFigures('# title\n\n- item\n\npara one\n\n| a |\n\npara two', lines).split(
    '\n\n',
  );
  assert.deepEqual(out.slice(0, 4), ['# title', '- item', 'para one', lines[0]]);
  assert.equal(out.at(-1), lines[2]);
});

test('the box call is told by the prompt head and answers every figure id', () => {
  const parts = [text('HEAD\nrest'), text('Figure 1 (slide 3): a'), text('Figure 2 (slide 5): b')];
  assert.equal(isBoxCall(parts, 'HEAD'), true);
  assert.equal(isBoxCall([text('other')], 'HEAD'), false);
  assert.deepEqual(JSON.parse(boxReply(parts)), {
    figures: [
      { id: 1, found: true, box_2d: FIGURE_BOXES[0] },
      { id: 2, found: true, box_2d: FIGURE_BOXES[1] },
    ],
  });
});
