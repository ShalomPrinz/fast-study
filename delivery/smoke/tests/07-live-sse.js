import { expect } from '@playwright/test';
import { byTestId, openLecture } from '../lib/lecture.js';
import { tone } from '../lib/media.js';
import { services, session } from '../lib/session.js';
import { COURSE } from '../lib/suite.js';

const LIVE_LECTURE = 'Live Update Lecture';

export default async function liveSseUpdate() {
  const { page } = session;
  const { db, api } = services;
  await db.putVideo(COURSE, LIVE_LECTURE, await tone());
  await openLecture(page, COURSE, LIVE_LECTURE);
  const audio = byTestId(page, 'step-status', { step: 'audio' });
  await expect(audio).toHaveAttribute('data-status', 'pending');

  // Lives exactly as long as this document: a reload or a navigation drops it.
  await page.evaluate(() => {
    window.__smokeSameDocument = true;
  });
  expect(await api.runStep(COURSE, LIVE_LECTURE, 'audio'), 'the audio step failed').toBeNull();
  await expect(audio).toHaveAttribute('data-status', 'done');
  expect(await page.evaluate(() => window.__smokeSameDocument), 'the page reloaded').toBe(true);
}
