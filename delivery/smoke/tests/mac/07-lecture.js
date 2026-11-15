import { expect } from '@playwright/test';
import { completeInitWall } from '../../lib/firstRun.js';
import { openLecture } from '../../lib/lecture.js';
import { evidence } from '../../lib/mac.js';
import { tone } from '../../lib/media.js';
import * as paths from '../../lib/paths.js';
import { services, session } from '../../lib/session.js';
import { COURSE, fixture, LECTURE } from '../../lib/suite.js';

// What the shared PDF test builds on, until the shared first-run and provider-step tests land here:
// the init wall passed onto a data root, and a lecture with audio.mp3 and the fixed transcript.
export default async function pdfState() {
  const { page } = session;
  const { db, api } = services;
  await completeInitWall(session, paths.dataRoot('data'));
  await services.db.configured();
  await db.createCourse(COURSE);
  await db.putVideo(COURSE, LECTURE, await tone());
  await openLecture(page, COURSE, LECTURE);
  expect(await api.runStep(COURSE, LECTURE, 'audio'), 'the audio step failed').toBeNull();
  expect(await db.exists(COURSE, LECTURE, 'audio.mp3')).toBe(true);
  await db.putFile(COURSE, LECTURE, 'transcript.txt', fixture('transcript.txt'));
  evidence(
    '7. the data folder and the lecture the PDF renders',
    `${paths.dataRoot('data')}\naudio.mp3 and transcript.txt present`,
  );
}
