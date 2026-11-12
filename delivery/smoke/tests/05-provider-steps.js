import { expect, test } from '@playwright/test';
import { expectNetworkFailure, openLecture } from '../lib/lecture.js';
import { tone } from '../lib/media.js';
import { services, session } from '../lib/session.js';
import { COURSE, fixture, LECTURE } from '../lib/suite.js';

export default async function providerSteps() {
  const { page } = session;
  const { db, api } = services;
  await db.createCourse(COURSE);
  await db.putVideo(COURSE, LECTURE, await tone());
  await openLecture(page, COURSE, LECTURE);

  await test.step('audio extraction runs for real', async () => {
    expect(await api.runStep(COURSE, LECTURE, 'audio'), 'the audio step failed').toBeNull();
    expect(await db.exists(COURSE, LECTURE, 'audio.mp3')).toBe(true);
  });
  await test.step('transcribe fails on the network', () =>
    expectNetworkFailure(page, COURSE, LECTURE, 'transcribe'));
  await db.putFile(COURSE, LECTURE, 'transcript.txt', fixture('transcript.txt'));
  await test.step('summarize fails on the network over the fixed transcript', () =>
    expectNetworkFailure(page, COURSE, LECTURE, 'summarize'));
}
