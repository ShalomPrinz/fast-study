import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readLaunchLog } from '../../lib/app.js';
import { serveFiles } from '../../lib/fileServer.js';
import { evidence, offlineArgv, run, screenshot, shown } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';
import { forget, session, start, stop } from '../../lib/session.js';
import { pointUpdaterAt } from '../../lib/updateServer.js';
import { delay, waitFor } from '../../lib/wait.js';
import { verifyBundle } from './02-signatures.js';

// Electron names safeStorage's Keychain item after the product.
const KEYCHAIN_SERVICE = `${paths.PRODUCT} Safe Storage`;
const SEEDED_KEYS = { geminiApiKey: 'smoke-gemini-key', groqApiKey: 'smoke-groq-key' };

const HELPER_STARTED = (bundle) =>
  `started ${bundle}/Contents/MacOS/${paths.PRODUCT} with the handoff on fd 3`;
const DELETED = 'handoff: deleted 1 "FastStudy Safe Storage" Keychain item(s)';
const REENCRYPTED = 'handoff: re-encrypted gemini_api_key, groq_api_key, token_key';
const REGENERATED = 'token key could not be decrypted and was regenerated';
const PROMPT_TIMEOUT = 'then the delete failed: timed out — a Keychain prompt is the likely cause';
const NO_KEY_STORE = 'no token key';
const FAILURE_LINES = [
  /handoff not adopted: .*/,
  /handoff unreadable, the stored keys are left as they were: .*/,
  /\[updater\] installing without a key handoff, the stored keys are left as they were: .*/,
];

const readUpdateLog = () => {
  try {
    return fs.readFileSync(paths.updateLog(), 'utf8');
  } catch {
    return '';
  }
};

const pendingFile = () => path.join(paths.stateRoot(), 'update', 'pending.json');

const keychainItem = async () =>
  (await run('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE])).code === 0;

/** How many "FastStudy Safe Storage" items the keychains hold, from the metadata dump (no secrets
 *  read, so no prompt, and nothing deleted); null when the dump itself fails. */
async function keychainCount() {
  const dump = await run('/usr/bin/security', ['dump-keychain'], { timeoutMs: 60_000 });
  if (dump.code !== 0) return null;
  return dump.stdout
    .split('\n')
    .filter((line) => /"svce"<blob>=/.test(line) && line.includes(`"${KEYCHAIN_SERVICE}"`)).length;
}

/** What the install did to the stored keys, as one verdict line; reported, never asserted. */
function verdictOf({ previousLog, candidateLog, booted }) {
  if (previousLog.includes(NO_KEY_STORE) || candidateLog.includes(NO_KEY_STORE)) {
    return 'UNAVAILABLE: safeStorage had no key store on this runner, so the check proved nothing';
  }
  if (candidateLog.includes(REGENERATED)) {
    return 'REGENERATED: the updated build could not decrypt the previous build’s token_key';
  }
  if (candidateLog.includes(PROMPT_TIMEOUT)) {
    return 'KEYCHAIN-PROMPT: deleting the old Keychain item timed out, so a system prompt is blocking it and the fallback is needed';
  }
  if (!booted) {
    return 'HUNG: the updated build never finished booting — a Keychain prompt, or a previous build older than the key handoff (its helper uses `open`); see after-update-screen.png';
  }
  const failure = [previousLog, candidateLog]
    .flatMap((log) => log.split('\n'))
    .find((line) => FAILURE_LINES.some((re) => re.test(line)));
  if (failure) return `NOT-ADOPTED: ${failure}`;
  if (candidateLog.includes(DELETED) && candidateLog.includes(REENCRYPTED)) {
    return 'ADOPTED: the old Keychain item was deleted and every stored key re-encrypted under a new one';
  }
  return 'INCONCLUSIVE: no handoff line and no failure line in launch.log';
}

/** The state both scenarios start from: no candidate bundle, no state root, no Keychain item. */
async function reset(label) {
  await stop();
  fs.rmSync(paths.macBundle(), { recursive: true, force: true });
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
    `7${label}. Keychain reset before the update`,
    [...removed, `"${KEYCHAIN_SERVICE}" present afterwards: ${await keychainItem()}`].join('\n'),
  );
}

/** Unpack the previous build, point its updater at the feed, re-sign it. */
async function installPrevious(previous, feedUrl) {
  const unzip = await shown('/usr/bin/ditto', ['-x', '-k', previous.zip, '/Applications'], {
    timeoutMs: 10 * 60_000,
  });
  expect(unzip.code, unzip.text).toBe(0);
  pointUpdaterAt(paths.appUpdateYml(), feedUrl);
  // The edit broke the seal; signed before the first launch, so one signature made token_key.
  const bundle = paths.macBundle();
  const sign = await shown('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], {
    timeoutMs: 15 * 60_000,
  });
  expect(sign.code, sign.text).toBe(0);
  const verify = await shown('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
    timeoutMs: 10 * 60_000,
  });
  expect(verify.code, verify.text).toBe(0);
}

/** Launch the previous build, store both API keys the way the settings screen does, and wait for it to
 *  download the candidate. */
async function downloadWithKeys(previous, candidate, feed) {
  await start();
  expect(readLaunchLog().split('\n')[0]).toContain(`FastStudy ${previous.version} `);
  await session.page.evaluate((patch) => window.faststudy.settings.write(patch), SEEDED_KEYS);
  const flags = await session.page.evaluate(() => window.faststudy.settings.read());
  expect(flags.geminiApiKeySet, 'the previous build did not store the Gemini key').toBe(true);
  expect(flags.groqApiKeySet, 'the previous build did not store the Groq key').toBe(true);
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
      message: () => `no "${downloaded}" in launch.log; the feed saw: ${feed.requests.join(', ')}`,
    },
  );
}

/** Follow launch.log while `until()` is false, keeping the longest copy whose first line `ownLaunch`
 *  accepts; the next launch truncates the file, so a copy read afterwards would be the wrong one. */
async function followLog(ownLaunch, until, timeoutMs = 120_000) {
  let kept = '';
  const keep = () => {
    const log = readLaunchLog();
    if (ownLaunch(log.split('\n')[0]) && log.length > kept.length) kept = log;
  };
  for (const deadline = Date.now() + timeoutMs; !until() && Date.now() < deadline;) {
    keep();
    await delay(50);
  }
  keep();
  return kept;
}

/** The relaunched build, started outside Playwright by the helper: read launch.log until it loads. */
async function awaitCandidate(candidate) {
  const line = `FastStudy ${candidate.version} `;
  return waitFor(
    () => readLaunchLog().split('\n')[0].includes(line) && /app loaded /.test(readLaunchLog()),
    { timeoutMs: 4 * 60_000, intervalMs: 1000, message: 'never' },
  ).catch(() => false);
}

const killBundle = async () => {
  await run('/usr/bin/pkill', ['-TERM', '-f', paths.macBundle()]);
  await delay(5000);
  await run('/usr/bin/pkill', ['-KILL', '-f', paths.macBundle()]);
};

/** Launch the candidate under Playwright and read both key flags through the bridge. */
async function keysSetInCandidate(candidate) {
  await start();
  expect(readLaunchLog().split('\n')[0]).toContain(`FastStudy ${candidate.version} `);
  const flags = await session.page.evaluate(() => window.faststudy.settings.read());
  const log = readLaunchLog();
  await stop();
  return { flags, log };
}

/** Exactly one Keychain item must remain — counted from the metadata dump, else by deleting it twice
 *  (the second delete must exit 44, not found). Destroys the item, so it runs after every key check. */
async function expectOneKeychainItem(label) {
  const found = await keychainItem();
  const count = await keychainCount();
  const lines = [`find-generic-password succeeds: ${found}`, `dump-keychain count: ${count}`];
  if (count === null) {
    const first = await shown('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    const second = await run('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    lines.push(first.text, `second delete exit: ${second.code}`);
    evidence(`7${label}. Keychain items after the update`, lines.join('\n'));
    expect(first.text, 'the first delete found no item').toContain('(exit 0)');
    expect(second.code, 'a second Keychain item remained').toBe(44);
  } else {
    evidence(`7${label}. Keychain items after the update`, lines.join('\n'));
    expect(count, 'not exactly one "FastStudy Safe Storage" item after the update').toBe(1);
  }
  expect(found, 'no "FastStudy Safe Storage" item after the update').toBe(true);
}

/** Restart now: the old build writes the keys to the helper, which swaps and starts the new build with them. */
async function scenarioRestartNow({ candidate, previous, bundle }) {
  await reset('a');
  const feed = await serveFiles(candidate.dir);
  let previousLog = '';
  try {
    await test.step(`A. install ${previous.version} pointed at a loopback feed`, () =>
      installPrevious(previous, feed.url));
    await test.step(`A. ${previous.version} stores two keys and downloads ${candidate.version}`, () =>
      downloadWithKeys(previous, candidate, feed));

    await test.step('A. Restart now quits, and the helper swaps the bundle and starts the new build', async () => {
      const { app, page, n } = session;
      const exited = new Promise((resolve) => app.process().once('exit', resolve));
      await app
        .context()
        .tracing.stop()
        .catch(() => {});
      // The call's answer dies with the app, so only the exit is awaited.
      page.evaluate(() => window.faststudy.updates.restart()).catch(() => {});
      let done = false;
      exited.then(() => (done = true));
      previousLog = await followLog(
        (
          (first) => (line) =>
            line === first
        )(readLaunchLog().split('\n')[0]),
        () => done,
      );
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
          return /swapped: .* is the new build/.test(log) && log.includes(HELPER_STARTED(bundle));
        },
        {
          timeoutMs: 5 * 60_000,
          intervalMs: 500,
          message: () => `update.log never reported the swap and the start:\n${readUpdateLog()}`,
        },
      );
    });
  } finally {
    await feed.close();
  }

  const booted = await awaitCandidate(candidate);
  if (!booted) await screenshot('after-update-screen.png');
  const candidateLog = readLaunchLog();
  const plist = await shown('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    `${bundle}/Contents/Info.plist`,
  ]);
  const verdict = verdictOf({ previousLog, candidateLog, booted });
  evidence(
    '7a. Restart now',
    [
      verdict,
      `launch.log of ${previous.version}, updater lines:`,
      ...previousLog.split('\n').filter((line) => /\[updater\]/.test(line)),
      'update.log:',
      readUpdateLog().trim(),
      `feed requests: ${feed.requests.join(', ')}`,
      plist.text,
      `launch.log of the started build (${booted ? 'booted' : 'NOT booted'}):`,
      candidateLog.trim(),
    ].join('\n'),
  );
  console.log(`::warning title=macOS update, Restart now::${verdict}`);
  await killBundle();

  expect(previousLog, 'the quitting launch logged no install helper').toContain(
    'install helper started (pid ',
  );
  expect(plist.text, 'the bundle in place is not the candidate').toContain(candidate.version);
  expect(readUpdateLog(), 'the helper did not start the new build with the handoff').toContain(
    HELPER_STARTED(bundle),
  );
  expect(candidateLog.split('\n')[0], 'the helper started nothing, or the wrong version').toContain(
    `FastStudy ${candidate.version} `,
  );
  expect(booted, `the started ${candidate.version} never loaded the app:\n${candidateLog}`).toBe(
    true,
  );
  expect(candidateLog, 'the old Keychain item was not deleted exactly once').toContain(DELETED);
  expect(candidateLog, 'the stored keys were not re-encrypted').toContain(REENCRYPTED);
  expect(candidateLog, 'token_key was regenerated, not carried').not.toContain(REGENERATED);
  expect(candidateLog, 'the Keychain delete hit a prompt').not.toContain(PROMPT_TIMEOUT);
  await verifyBundle('7a. codesign --verify on the swapped bundle');

  const { flags, log } = await keysSetInCandidate(candidate);
  expect(flags.geminiApiKeySet, 'the Gemini key did not survive the update').toBe(true);
  expect(flags.groqApiKeySet, 'the Groq key did not survive the update').toBe(true);
  expect(log, 'token_key was regenerated on the candidate’s second launch').not.toContain(
    REGENERATED,
  );
  await expectOneKeychainItem('a');
}

/** Quit, then relaunch: a plain quit installs nothing, and the old build's next launch installs it. */
async function scenarioQuitThenRelaunch({ candidate, previous, bundle }) {
  await reset('b');
  const feed = await serveFiles(candidate.dir);
  try {
    await test.step(`B. install ${previous.version} pointed at a loopback feed`, () =>
      installPrevious(previous, feed.url));
    await test.step(`B. ${previous.version} stores two keys, downloads ${candidate.version} and quits`, async () => {
      await downloadWithKeys(previous, candidate, feed);
      await stop();
    });
  } finally {
    await feed.close();
  }

  const quitPlist = await shown('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    `${bundle}/Contents/Info.plist`,
  ]);
  evidence(
    '7b. after a plain quit',
    [
      quitPlist.text,
      `update.log present: ${fs.existsSync(paths.updateLog())}`,
      `pending.json present: ${fs.existsSync(pendingFile())}`,
    ].join('\n'),
  );
  expect(quitPlist.text, 'a plain quit swapped the bundle').toContain(previous.version);
  expect(fs.existsSync(paths.updateLog()), 'a plain quit started the install helper').toBe(false);
  expect(fs.existsSync(pendingFile()), 'the downloaded update left no pending.json').toBe(true);

  // The old build quits before any window, so Playwright cannot drive this launch.
  const staleFirstLine = readLaunchLog().split('\n')[0];
  const old = spawn(...offlineArgv(paths.appExe(), ['--lang=en-US']), {
    detached: true,
    stdio: 'ignore',
  });
  old.unref();
  // Lines open with a timestamp, and the log still holds this build's earlier Playwright launch.
  const oldVersion = `FastStudy ${previous.version} `;
  const ownLaunch = (line) => line.includes(oldVersion) && line !== staleFirstLine;
  const installLine = '[updater] install helper started (pid ';
  const previousLog = await followLog(
    ownLaunch,
    () => ownLaunch(readLaunchLog().split('\n')[0]) && readLaunchLog().includes(installLine),
  );

  await waitFor(
    () => {
      const log = readUpdateLog();
      if (/gave up|swap failed/.test(log)) throw new Error(`the install step failed:\n${log}`);
      return /swapped: .* is the new build/.test(log) && log.includes(HELPER_STARTED(bundle));
    },
    {
      timeoutMs: 5 * 60_000,
      intervalMs: 500,
      message: () => `update.log never reported the swap and the start:\n${readUpdateLog()}`,
    },
  );
  const booted = await awaitCandidate(candidate);
  if (!booted) await screenshot('after-relaunch-screen.png');
  const candidateLog = readLaunchLog();
  const plist = await shown('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    `${bundle}/Contents/Info.plist`,
  ]);
  const verdict = verdictOf({ previousLog, candidateLog, booted });
  evidence(
    '7b. quit, then relaunch',
    [
      verdict,
      `launch.log of ${previous.version}'s relaunch:`,
      previousLog.trim(),
      'update.log:',
      readUpdateLog().trim(),
      plist.text,
      `launch.log of the started build (${booted ? 'booted' : 'NOT booted'}):`,
      candidateLog.trim(),
    ].join('\n'),
  );
  console.log(`::warning title=macOS update, quit then relaunch::${verdict}`);
  await killBundle();

  expect(previousLog, 'the relaunched old build did not verify the staged update').toMatch(
    new RegExp(
      `\\[updater\\] version ${candidate.version} verified in \\d+ms — installing it before this launch`,
    ),
  );
  expect(previousLog, 'the relaunched old build started no install helper').toMatch(
    /\[updater\] install helper started \(pid \d+\) — it logs to /,
  );
  expect(plist.text, 'the bundle in place is not the candidate').toContain(candidate.version);
  expect(candidateLog.split('\n')[0]).toContain(`FastStudy ${candidate.version} `);
  expect(booted, `the started ${candidate.version} never loaded the app:\n${candidateLog}`).toBe(
    true,
  );
  expect(candidateLog).toContain(
    `[updater] pending update cleared: ${candidate.version} is not newer than this build`,
  );
  expect(candidateLog, 'the old Keychain item was not deleted exactly once').toContain(DELETED);
  expect(candidateLog, 'the stored keys were not re-encrypted').toContain(REENCRYPTED);
  expect(candidateLog, 'token_key was regenerated, not carried').not.toContain(REGENERATED);
  expect(candidateLog, 'the Keychain delete hit a prompt').not.toContain(PROMPT_TIMEOUT);

  const { flags, log } = await keysSetInCandidate(candidate);
  expect(flags.geminiApiKeySet, 'the Gemini key did not survive the relaunch install').toBe(true);
  expect(flags.groqApiKeySet, 'the Groq key did not survive the relaunch install').toBe(true);
  expect(log, 'token_key was regenerated on the candidate’s second launch').not.toContain(
    REGENERATED,
  );
  await expectOneKeychainItem('b');
}

export default async function update() {
  const scenario = {
    candidate: paths.macCandidate(),
    previous: paths.macPrevious(),
    bundle: paths.macBundle(),
  };
  await scenarioRestartNow(scenario);
  await scenarioQuitThenRelaunch(scenario);
}
