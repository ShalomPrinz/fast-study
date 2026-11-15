import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { evidence, run, stopProcesses } from '../../lib/mac.js';
import { services } from '../../lib/session.js';
import { COURSE, LECTURE } from '../../lib/suite.js';
import { waitFor } from '../../lib/wait.js';
import { clickOpenPdf } from '../09-open-pdf.js';

// Files Preview holds open, by real path: lsof reports `/private/var/...` where the lecture path may say `/var/...`.
async function previewFiles() {
  const { stdout } = await run('/usr/sbin/lsof', ['-nP', '-c', 'Preview', '-Fn']);
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('n/'))
    .map((line) => line.slice(1));
}

// The shared click, then Preview's open file table must name summary.pdf. No Preview is ever the app's child: LaunchServices starts it.
export default async function openingPdf() {
  const file = fs.realpathSync(await services.db.path(COURSE, LECTURE, 'summary.pdf'));
  let held = [];
  await stopProcesses(['Preview']);
  try {
    await clickOpenPdf();
    await test.step('Preview opens summary.pdf', async () => {
      await waitFor(async () => (held = await previewFiles()).includes(file), {
        timeoutMs: 60_000,
        intervalMs: 2000,
        message: () =>
          `no Preview process holds ${file}; it holds ${JSON.stringify(held.filter((f) => /\.pdf$/i.test(f)))}`,
      });
      expect(held).toContain(file);
    });
  } finally {
    const open = held.filter((f) => /\.pdf$/i.test(f));
    await stopProcesses(['Preview']);
    evidence(
      'opening a PDF',
      `${file}\nPDFs Preview held when last sampled: ${JSON.stringify(open)}`,
      { print: false },
    );
  }
}
