import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { evidence, run } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';

const PROBE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'mac',
  'zoom-probe.mjs',
);

export default async function zoomHidden() {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  // Unset is the shipped default; set, the launch would keep the window on screen.
  delete env.FASTSTUDY_ZOOM_VISIBLE;
  // The shipped code on the shipped runtime: the staged `auto`, run by the app binary as node.
  const probe = await run(
    paths.appExe(),
    [PROBE, path.join(paths.resourcesDir(), 'downloader', 'auto'), paths.workDir()],
    { timeoutMs: 5 * 60_000, env },
  );
  evidence(
    '6. zoom browser hidden state',
    [`probe exit ${probe.code}`, probe.stdout.trim(), probe.stderr.trim()].join('\n'),
  );
  expect(probe.code, `${probe.stdout}\n${probe.stderr}`).toBe(0);
}
