import path from 'node:path';
import { expect } from '@playwright/test';
import * as paths from '../lib/paths.js';
import { unresolvedImports } from '../lib/pe.js';

export default function dllImports() {
  // The runner image carries VC++ runtimes a user's PC may not, so read the imports rather than
  // trusting that everything loads here. DLLs loaded at runtime (LoadLibrary, ctypes) are not covered.
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const { scanned, failures } = unresolvedImports(paths.installDir(), system32);
  expect(
    scanned,
    'no PE file under the install dir parsed; the import reader is broken',
  ).toBeGreaterThan(0);
  expect(
    failures.map(({ file, missing }) => `${file}: ${missing.join(', ')}`),
    'imports neither shipped nor a non-redistributable System32 DLL',
  ).toEqual([]);
}
