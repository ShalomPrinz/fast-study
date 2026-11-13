import { expect } from '@playwright/test';
import { evidence, shown } from '../../lib/mac.js';
import { checkMachOs, describe } from '../../lib/macho.js';
import * as paths from '../../lib/paths.js';

/** The bundle's seal and every Mach-O inside it; shared with the update check, which runs it on the swapped bundle. */
export async function verifyBundle(title) {
  const bundle = paths.macBundle();
  const deep = await shown(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', bundle],
    { timeoutMs: 10 * 60_000 },
  );
  const identity = await shown('/usr/bin/codesign', ['-dvv', bundle]);
  const found = checkMachOs(bundle);
  evidence(title, [deep.text, identity.text, describe(found)].join('\n'));
  expect(deep.code, deep.text).toBe(0);
  expect(found.length, `no Mach-O found under ${bundle}`).toBeGreaterThan(0);
  expect(
    found.filter((entry) => entry.error).map((entry) => `${entry.file}: ${entry.error}`),
    'Mach-O files that do not verify, or cannot run without Rosetta',
  ).toEqual([]);
}

export default async function signatures() {
  await verifyBundle('2. codesign --verify');
}
