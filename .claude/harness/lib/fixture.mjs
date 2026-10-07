// Pure helpers over the fixture transcript, so the self-check derives its expectation from the file.
import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_ROOT } from './env.mjs';

/** The fixture transcript's paragraphs, split the way the fake Groq serves them. */
export const paragraphsOf = (text) => text.split(/\n\s*\n/).filter(Boolean);

export const fixtureParagraphs = () =>
  paragraphsOf(fs.readFileSync(path.join(HARNESS_ROOT, 'fixtures', 'transcript.txt'), 'utf8'));

/** True when the transcript holds at least one whole fixture paragraph (the fake serves them in rotation). */
export const containsFixtureParagraph = (transcript, paragraphs) =>
  paragraphs.some((paragraph) => transcript.includes(paragraph.trim()));
