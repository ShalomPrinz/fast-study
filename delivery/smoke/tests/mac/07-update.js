import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readLaunchLog } from '../../lib/app.js';
import { serveFiles } from '../../lib/fileServer.js';
import { evidence, run, screenshot, shown } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';
import { forget, session, start, stop } from '../../lib/session.js';
import { pointUpdaterAt } from '../../lib/updateServer.js';
import { delay, waitFor } from '../../lib/wait.js';
import { verifyBundle } from './02-signatures.js';

// Electron names safeStorage's Keychain item after the product.
const KEYCHAIN_SERVICE = `${paths.PRODUCT} Safe Storage`;
const REGENERATED = 'token key could not be decrypted and was regenerated';
const NO_KEY_STORE = 'no token key';

const readUpdateLog = () => {
  try {
    return fs.readFileSync(paths.updateLog(), 'utf8');
  } catch {
    return '';
  }
};

/** `token_key` as settings.json holds it — safeStorage ciphertext, so only its hash is reported. */
function tokenKey() {
  try {
    const stored = JSON.parse(fs.readFileSync(paths.settingsFile(), 'utf8')).token_key;
    return stored ? crypto.createHash('sha256').update(String(stored)).digest('hex') : null;
  } catch {
    return null;
  }
}

const keychainItem = async () =>
  (await run('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE])).code === 0;

/** What the update did to a safeStorage value, as one verdict line; reported, never asserted. */
function safeStorageVerdict({ before, after, previousLog, candidateLog, booted }) {
  if (previousLog.includes(NO_KEY_STORE) || candidateLog.includes(NO_KEY_STORE)) {
    return 'UNAVAILABLE: safeStorage had no key store on this runner, so the check proved nothing';
  }
  if (candidateLog.includes(REGENERATED)) {
    return 'REGENERATED: the updated build could not decrypt the previous build’s token_key';
  }
  if (!booted) {
    return 'HUNG: the updated build never finished booting — a Keychain prompt is the likely cause, see after-update-screen.png';
  }
  if (!before) return 'INCONCLUSIVE: the previous build stored no token_key';
  if (before === after)
    return 'SURVIVED: token_key is byte-identical and decrypted after the update';
  return 'INCONCLUSIVE: token_key changed with no regeneration line in launch.log';
}

export default async function update() {
  const candidate = paths.macCandidate();
  const previous = paths.macPrevious();
  const bundle = paths.macBundle();
  await stop();

  await test.step('remove the candidate, its state root and its Keychain item', async () => {
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.rmSync(paths.stateRoot(), { recursive: true, force: true });
    // Left behind, the previous build would meet an item another signature made before any update ran.
    const removed = [];
    for (let i = 0; i < 5 && (await keychainItem()); i++) {
      removed.push(
        (
          await shown('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE])
        ).text.split('\n')[0],
      );
    }
    evidence(
      '7a. Keychain reset before the update',
      [...removed, `"${KEYCHAIN_SERVICE}" present afterwards: ${await keychainItem()}`].join(
        '\n',
      ) || 'no item to remove',
    );
  });

  const feed = await serveFiles(candidate.dir);
  let previousLog = '';
  let before = null;
  try {
    await test.step(`install ${previous.version} pointed at a loopback feed`, async () => {
      const unzip = await shown('/usr/bin/ditto', ['-x', '-k', previous.zip, '/Applications'], {
        timeoutMs: 10 * 60_000,
      });
      expect(unzip.code, unzip.text).toBe(0);
      pointUpdaterAt(paths.appUpdateYml(), feed.url);
      // The edit broke the seal; signed before the first launch, so one signature made token_key.
      const sign = await shown('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], {
        timeoutMs: 15 * 60_000,
      });
      expect(sign.code, sign.text).toBe(0);
      const verify = await shown('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
        timeoutMs: 10 * 60_000,
      });
      expect(verify.code, verify.text).toBe(0);
    });

    await test.step(`${previous.version} downloads ${candidate.version}`, async () => {
      await start();
      expect(readLaunchLog().split('\n')[0]).toContain(`FastStudy ${previous.version} `);
      const downloaded = `[updater] version ${candidate.version} downloaded`;
      await waitFor(
        () => {
          const failure = readLaunchLog()
            .split('\n')
            .find((line) => /\[updater\] (error: |check failed: )/.test(line));
          if (failure) throw new Error(`the updater failed: ${failure}`);
          return readLaunchLog().includes(downloaded);
        },
        {
          timeoutMs: 10 * 60_000,
          intervalMs: 2000,
          message: () =>
            `no "${downloaded}" in launch.log; the feed saw: ${feed.requests.join(', ')}`,
        },
      );
      before = tokenKey();
    });

    await test.step('Restart now quits, and the helper swaps the bundle and relaunches', async () => {
      const { app, page, n } = session;
      const exited = new Promise((resolve) => app.process().once('exit', resolve));
      await app
        .context()
        .tracing.stop()
        .catch(() => {});
      // The call's answer dies with the app, so only the exit is awaited.
      page.evaluate(() => window.faststudy.updates.restart()).catch(() => {});
      // The relaunch truncates launch.log, so the quitting launch's last lines are kept as they appear.
      const firstLine = readLaunchLog().split('\n')[0];
      let done = false;
      exited.then(() => (done = true));
      for (const deadline = Date.now() + 120_000; !done && Date.now() < deadline;) {
        const log = readLaunchLog();
        if (log.startsWith(firstLine) && log.length > previousLog.length) previousLog = log;
        await delay(50);
      }
      const last = readLaunchLog();
      if (last.startsWith(firstLine) && last.length > previousLog.length) previousLog = last;
      forget();
      await app.close().catch(() => {});
      expect(done, 'the app was still running 2 minutes after Restart now').toBe(true);
      // Not saveLaunchLog: by now launch.log may already be the relaunched build's.
      fs.mkdirSync(path.join(paths.resultsDir(), 'launch-logs'), { recursive: true });
      fs.writeFileSync(
        path.join(paths.resultsDir(), 'launch-logs', `launch-${n}.log`),
        previousLog,
      );

      await waitFor(
        () => {
          const log = readUpdateLog();
          if (/gave up|swap failed/.test(log)) throw new Error(`the install step failed:\n${log}`);
          return /swapped: .* is the new build/.test(log) && log.includes('relaunching ');
        },
        {
          timeoutMs: 5 * 60_000,
          intervalMs: 500,
          message: () => `update.log never reported the swap and relaunch:\n${readUpdateLog()}`,
        },
      );
    });
  } finally {
    await feed.close();
  }

  // The relaunch is the helper's `open`, outside Playwright, so launch.log is all there is to read.
  const candidateLine = `FastStudy ${candidate.version} `;
  const booted = await waitFor(
    () =>
      readLaunchLog().split('\n')[0].includes(candidateLine) && /app loaded /.test(readLaunchLog()),
    { timeoutMs: 4 * 60_000, intervalMs: 1000, message: 'never' },
  ).catch(() => false);
  if (!booted) await screenshot('after-update-screen.png');
  const candidateLog = readLaunchLog();
  const after = tokenKey();
  const plist = await shown('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    `${bundle}/Contents/Info.plist`,
  ]);

  const verdict = safeStorageVerdict({ before, after, previousLog, candidateLog, booted });
  evidence(
    '7b. updater swap',
    [
      `launch.log of ${previous.version}, updater and token key lines:`,
      ...previousLog.split('\n').filter((line) => /\[updater\]|token key/.test(line)),
      'update.log:',
      readUpdateLog().trim(),
      `feed requests: ${feed.requests.join(', ')}`,
      plist.text,
      `launch.log after the relaunch (${booted ? 'booted' : 'NOT booted'}):`,
      candidateLog.trim(),
    ].join('\n'),
  );
  evidence(
    '7c. safeStorage across the update (reported, not asserted)',
    [
      verdict,
      `token_key sha256 before: ${before}`,
      `token_key sha256 after:  ${after}`,
      `"${KEYCHAIN_SERVICE}" in the Keychain: ${await keychainItem()}`,
    ].join('\n'),
  );
  // A workflow command, so the verdict is an annotation on the run whatever the job's outcome.
  console.log(`::warning title=safeStorage across a macOS update::${verdict}`);

  await run('/usr/bin/pkill', ['-TERM', '-f', bundle]);
  await delay(5000);
  await run('/usr/bin/pkill', ['-KILL', '-f', bundle]);

  expect(previousLog, 'the quitting launch logged no install helper').toContain(
    'install helper started (pid ',
  );
  expect(plist.text, 'the bundle in place is not the candidate').toContain(candidate.version);
  expect(
    candidateLog.split('\n')[0],
    'the helper relaunched nothing, or the wrong version',
  ).toContain(candidateLine);
  expect(booted, `the relaunched ${candidate.version} never loaded the app:\n${candidateLog}`).toBe(
    true,
  );
  await verifyBundle('7d. codesign --verify on the swapped bundle');
}
