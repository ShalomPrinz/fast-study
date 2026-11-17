import { expect, test } from '@playwright/test';
import { removeBrowser, restoreBrowsers } from '../lib/browsers.js';
import { services, start, stop } from '../lib/session.js';
import { COURSE, fixture } from '../lib/suite.js';

const SECOND_LECTURE = 'No Browser Lecture';

// `observed` collects what each leg saw, for a wrapper's evidence.
export async function passBrowserChain(observed) {
  await stop();
  try {
    await test.step('with Chrome gone the prerequisite resolves Edge', async () => {
      await removeBrowser('chrome');
      const { page } = await start();
      await page.goto('app://bundle/settings');
      const prereq = page.getByTestId('browser-prereq');
      await expect(prereq).toHaveAttribute('data-status', 'available', { timeout: 90_000 });
      observed.chromeGone = `prerequisite ${await prereq.getAttribute('data-status')} on channel ${await prereq.getAttribute('data-channel')}`;
      await expect(prereq).toHaveAttribute('data-channel', 'msedge');
      await stop();
    });

    await test.step('with both gone settings shows the missing state and a PDF still renders', async () => {
      await removeBrowser('msedge');
      const { page } = await start();
      await page.goto('app://bundle/settings');
      await expect(page.getByTestId('browser-prereq')).toHaveAttribute('data-status', 'missing', {
        timeout: 90_000,
      });
      observed.bothGone = `prerequisite ${await page.getByTestId('browser-prereq').getAttribute('data-status')}`;
      await expect(page.getByTestId('browser-prereq-install-link')).toBeVisible();

      const { db, api } = services;
      await db.createLecture(COURSE, SECOND_LECTURE);
      await db.putSummary(COURSE, SECOND_LECTURE, fixture('summary.md').toString('utf8'));
      expect(await api.runStep(COURSE, SECOND_LECTURE, 'pdf'), 'the PDF step failed').toBeNull();
      observed.pdf = `summary.pdf exists: ${await db.exists(COURSE, SECOND_LECTURE, 'summary.pdf')}`;
      expect(await db.exists(COURSE, SECOND_LECTURE, 'summary.pdf')).toBe(true);
      await stop();
    });
  } finally {
    restoreBrowsers();
  }
}

export default async function browserChain() {
  await passBrowserChain({});
}
