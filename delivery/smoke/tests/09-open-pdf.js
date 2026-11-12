import { expect, test } from '@playwright/test';
import { openLecture } from '../lib/lecture.js';
import { services, session } from '../lib/session.js';
import { COURSE, LECTURE } from '../lib/suite.js';
import { delay, waitFor } from '../lib/wait.js';
import { holdExclusive, stopProcesses } from '../lib/windows.js';

export default async function openingPdf() {
  const { page } = session;
  const { db, api } = services;
  await openLecture(page, COURSE, LECTURE);

  await test.step('the open control resolves through the IPC path without an error toast', async () => {
    // The three header actions are inline on a wide window and behind the ⋮ menu on a narrow one,
    // so only one `open-pdf` is ever in the DOM; open the menu first when this window has one.
    const menu = page.getByTestId('lecture-actions-menu');
    if (await menu.count()) await menu.click();
    await page.getByTestId('open-pdf').click();
    // `shell.openPath` answers asynchronously and a failure's only surface is the toast.
    await delay(5_000);
    await expect(
      page.locator('.Toastify__toast--error'),
      'opening summary.pdf raised an error toast; a runner with no .pdf handler fails here too',
    ).toHaveCount(0);
  });

  await test.step('a PDF held exclusively renders the locked-file message', async () => {
    // Whatever the shell opened the PDF in would hold its own handle and block ours.
    await stopProcesses(['msedge', 'AcroRd32', 'Acrobat']);
    const file = await db.path(COURSE, LECTURE, 'summary.pdf');
    const lock = await waitFor(() => holdExclusive(file).catch(() => null), {
      timeoutMs: 60_000,
      intervalMs: 2000,
      message: `could not hold ${file} exclusively; whatever opened it still has it`,
    });
    try {
      const error = await api.runStep(COURSE, LECTURE, 'pdf');
      expect(error, 'the PDF step wrote over a locked summary.pdf').not.toBeNull();
      // database/'s code for a Windows sharing violation, which the backend forwards with its params.
      expect(error.code, error.message).toBe('file_locked');
      expect(error.params?.file).toBe('summary.pdf');
      await expect(page.getByTestId('lecture-error-message')).toBeVisible();
    } finally {
      await lock.release();
    }
  });
}
