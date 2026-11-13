import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { evidence, run, shown } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';

export default async function dmgInstall() {
  const { dmg, version } = paths.macCandidate();
  const mount = path.join(paths.workDir(), 'dmg');
  fs.mkdirSync(paths.workDir(), { recursive: true });
  fs.rmSync(paths.macBundle(), { recursive: true, force: true });

  const attach = await shown('/usr/bin/hdiutil', [
    'attach',
    dmg,
    '-nobrowse',
    '-readonly',
    '-mountpoint',
    mount,
  ]);
  expect(attach.code, attach.text).toBe(0);
  let copy;
  try {
    const listing = fs.readdirSync(mount);
    expect(listing, `the dmg holds ${listing.join(', ')}`).toContain(
      path.basename(paths.macBundle()),
    );
    // What dragging the app onto Applications does, symlinks, modes and signatures kept.
    copy = await shown(
      '/usr/bin/ditto',
      [path.join(mount, path.basename(paths.macBundle())), paths.macBundle()],
      { timeoutMs: 10 * 60_000 },
    );
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-force']);
  }
  expect(copy.code, copy.text).toBe(0);

  const plist = path.join(paths.macBundle(), 'Contents', 'Info.plist');
  const read = (key) => shown('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]);
  const installed = await read('CFBundleShortVersionString');
  const minimum = await read('LSMinimumSystemVersion');
  evidence('1. dmg install', [attach.text, copy.text, installed.text, minimum.text].join('\n'));
  expect(installed.text, 'the installed bundle is not the candidate version').toContain(version);
  for (const tool of ['ffmpeg', 'pandoc', 'tectonic', 'yt-dlp']) {
    fs.accessSync(path.join(paths.binDir(), tool), fs.constants.X_OK);
  }
  fs.accessSync(paths.appExe(), fs.constants.X_OK);
}
