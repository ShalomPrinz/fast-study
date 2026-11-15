import { expect } from '@playwright/test';
import { checkLinkage, describe } from '../../lib/linkage.js';
import { evidence } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';

export default function linkage() {
  // A stray /opt/homebrew link loads on this runner, which has Homebrew, and nowhere else.
  const found = checkLinkage(paths.macBundle());
  evidence('every Mach-O links only inside the bundle or the system', describe(found), {
    print: false,
  });
  expect(found.checked, 'no Mach-O parsed; the load-command reader is broken').toBeGreaterThan(0);
  expect(
    found.failures.map(({ file, offenders }) => `${file}: ${offenders.join(', ')}`),
    'links or rpaths neither inside the bundle nor under /usr/lib or /System',
  ).toEqual([]);
}
