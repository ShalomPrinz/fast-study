import { expect } from '@playwright/test';
import { byTestId, openLecture } from '../lib/lecture.js';
import { services, session } from '../lib/session.js';
import { COURSE, LECTURE } from '../lib/suite.js';
import { delay } from '../lib/wait.js';

export default async function driveOff() {
  const { page } = session;
  const { db, api } = services;
  await openLecture(page, COURSE, LECTURE);
  // The step rows of a complete lecture render only in the steps modal.
  await page.getByTestId('pipeline-steps-open').click();
  const steps = page.getByTestId('pipeline-steps-modal');
  await expect(byTestId(steps, 'step-status', { step: 'pdf' })).toHaveAttribute(
    'data-status',
    'done',
  );
  await expect(byTestId(steps, 'step-status', { step: 'drive' })).toHaveCount(0);
  await page.getByTestId('pipeline-steps-close').click();
  await expect(steps).toHaveCount(0);

  expect(await api.runPipeline(COURSE, LECTURE)).toEqual({ status: 'started' });
  // A run with nothing left never shows in flight, so a drive step would have to appear inside a
  // window: watch one long enough for it to start.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { in_flight: inFlight } = await api.status();
    const mine = inFlight.filter((entry) => entry.course === COURSE && entry.lecture === LECTURE);
    expect(mine, 'the pipeline ran a step past the PDF').toEqual([]);
    await expect(page.getByTestId('drive-consent-modal')).toHaveCount(0);
    await delay(500);
  }
  expect(await db.exists(COURSE, LECTURE, 'drive_url.txt'), 'a Drive upload happened').toBe(false);
}
