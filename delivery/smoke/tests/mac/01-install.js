import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { proveOfflineEnforcement } from '../../lib/offline.js';
import { OFFLINE_GROUP, evidence, offlineArgv, run, shown } from '../../lib/mac.js';
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

  await proveOffline();
}

// The run's premise, checked before any test depends on it: loopback reaches, nothing else does.
async function proveOffline() {
  const as = (file, args) => shown(...offlineArgv(file, args));
  const identity = await as('/usr/bin/id', ['-un']);
  const group = await as('/usr/bin/id', ['-gn']);
  const rules = await shown('/usr/bin/sudo', ['-n', '/sbin/pfctl', '-a', 'faststudy', '-sr']);
  expect(
    [identity.text, group.text].join('\n'),
    `assumption failed: sudo -u <runner> -g ${OFFLINE_GROUP} does not run the command as the runner under that primary group (sudoers drop-in missing?)`,
  ).toMatch(new RegExp(`${os.userInfo().username}[\\s\\S]*${OFFLINE_GROUP}`));

  // A grandchild: the group must survive a shell's own spawn, as the services' tools do.
  const child = await as('/bin/sh', [
    '-c',
    "/usr/bin/curl -sS -m 20 -o /dev/null -w '%{http_code}' https://github.com/",
  ]);
  let seen;
  try {
    seen = await proveOfflineEnforcement();
  } finally {
    evidence(
      '1. offline premise (pf group rule)',
      [identity.text, group.text, rules.text, child.text].join('\n'),
    );
  }
  evidence(
    '1. offline premise: what each probe saw',
    [
      `app as node, loopback:  ${seen.loopback}`,
      `runner, github.com:     ${seen.unblocked}`,
      `app as node, github.com: ${seen.blocked}`,
    ].join('\n'),
  );
  expect(child.code, `a child of the offline app reached github.com: ${child.text}`).not.toBe(0);
}
