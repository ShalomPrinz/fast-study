import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readLaunchLog } from '../lib/app.js';
import { recordBoot } from '../lib/bootTiming.js';
import { serveFiles } from '../lib/fileServer.js';
import { completeInitWall } from '../lib/firstRun.js';
import { formatsSnapshot, shippedFormats } from '../lib/formats.js';
import { expectNetworkFailure, openLecture } from '../lib/lecture.js';
import * as paths from '../lib/paths.js';
import { strayAfter } from '../lib/processes.js';
import { services, session, start, stop } from '../lib/session.js';
import { ASSUMPTION, failed, fixture, INSTALL_TIMEOUT_MS, LECTURE } from '../lib/suite.js';
import { pointUpdaterAt } from '../lib/updateServer.js';
import { waitFor } from '../lib/wait.js';
import { processesNamed, productVersion, runToExit } from '../lib/windows.js';

const UPDATE_COURSE = 'Update Course';

const MARKER = 'faststudy-smoke-marker.txt';

function fingerprint(file) {
  return {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    mtimeMs: fs.statSync(file).mtimeMs,
  };
}

/** The first three components: rcedit stamps a four-component ProductVersion, so the exe an 0.1.0
 *  installer wrote reports 0.1.0.0. */
function semverOf(version) {
  return version.trim().split('.').slice(0, 3).join('.');
}

/** What an update that never installed leaves behind, ending with the decisive probe: running the
 *  pending installer here separates a failing installer from a quit-time spawn that never ran. */
async function installForensics(installerSeen) {
  const exe = paths.appExe();
  const pending = paths.pendingInstaller();
  const lines = [
    `a process snapshot ${installerSeen ? 'caught an installer while waiting' : 'never caught an installer, which is the usual case'}`,
    `${exe} reports ProductVersion ${await productVersion(exe).catch((error) => `unreadable: ${error.message}`)}`,
    `${pending} ${fs.existsSync(pending) ? 'is still there' : 'is gone'}`,
  ];
  const log = path.join(paths.installDir(), 'install.log');
  if (fs.existsSync(log)) {
    lines.push(`tail of ${log}:`, fs.readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'));
  }
  if (fs.existsSync(pending)) {
    const run = await runToExit(pending, ['--updated', '/S'], {
      timeoutMs: INSTALL_TIMEOUT_MS,
      onTimeout: `${pending} --updated /S was still running after 5 minutes`,
    }).catch((error) => ({ code: 'no exit', output: error.message }));
    lines.push(`running it here exited ${run.code}: ${run.output.trim() || '(no output)'}`);
  }
  return lines.join('\n');
}

export default async function inPlaceUpdate() {
  const candidate = paths.candidate();
  const previous = paths.previous();
  await stop();

  await test.step('uninstall, and wipe the state root and userData', async () => {
    await runToExit(paths.uninstallerExe(), ['/S'], { timeoutMs: INSTALL_TIMEOUT_MS });
    // The NSIS uninstaller re-launches itself from a temp copy that deletes FastStudy.exe first and the registry keys last.
    await waitFor(
      async () =>
        !fs.existsSync(paths.installDir()) && (await processesNamed(['Au_*', 'Un_*'])).length === 0,
      {
        timeoutMs: INSTALL_TIMEOUT_MS,
        message: `${paths.installDir()} or its uninstaller was still there 5 minutes after the silent uninstall`,
      },
    );
    for (const dir of [paths.stateRoot(), paths.userData()]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test.step(`install ${previous.version}, complete first run, seed the yt-dlp copy`, async () => {
    const { code, output } = await runToExit(previous.installer, ['/S'], {
      timeoutMs: INSTALL_TIMEOUT_MS,
      onTimeout: `${failed(ASSUMPTION.nsis)}: ${previous.installer} /S was still running after 5 minutes`,
    });
    expect(code, `the installer exited ${code}: ${output}`).toBe(0);
    await start();
    expect(readLaunchLog().split('\n')[0]).toContain(`FastStudy ${previous.version} `);
    // The previous release may predate the privacy policy, so its first save may not ask.
    await completeInitWall(session, paths.dataRoot('data-update'), { requirePrivacy: false });
    await waitFor(() => fs.existsSync(paths.ytdlpCopy()), {
      timeoutMs: 60_000,
      message: `the server never seeded ${paths.ytdlpCopy()}`,
    });
    await stop();
  });
  const seeded = fingerprint(paths.ytdlpCopy());

  // The candidate's latest.yml, installer and blockmap, as a generic-provider feed.
  const feed = await serveFiles(candidate.dir);
  try {
    await test.step(`${previous.version} downloads ${candidate.version} from a loopback feed`, async () => {
      fs.writeFileSync(path.join(paths.resourcesDir(), MARKER), 'left by the previous install\n');
      pointUpdaterAt(paths.appUpdateYml(), feed.url);
      await start();
      const downloaded = `[updater] version ${candidate.version} downloaded`;
      await waitFor(
        () => {
          const log = readLaunchLog();
          // electron-updater logs its differential attempt failing as an error before the full
          // download it falls back to; that one is expected, since the feed has no old blockmap.
          const failure = log
            .split('\n')
            .find(
              (line) =>
                /\[updater\] (error: |check failed: )/.test(line) &&
                !line.includes('Cannot download differentially'),
            );
          if (failure) throw new Error(`${failed(ASSUMPTION.updater)}: ${failure}`);
          return log.includes(downloaded);
        },
        {
          timeoutMs: 10 * 60_000,
          intervalMs: 2000,
          message: () =>
            `no "${downloaded}" in launch.log; the feed saw: ${feed.requests.join(', ')}`,
        },
      );
      await stop();
    });

    await test.step('the silent NSIS install runs on quit and exits', async () => {
      const installers = ['FastStudy-Setup*', 'Un_*', 'Au_*'];
      // The outcome, not a live installer: the install overlaps the app's own shutdown and is
      // normally gone before the first poll, so a snapshot is evidence a failure carries, not the check.
      let installerSeen = false;
      try {
        await waitFor(
          async () => {
            if ((await processesNamed(installers)).length) installerSeen = true;
            const reported = await productVersion(paths.appExe()).catch(() => null);
            return reported !== null && semverOf(reported) === semverOf(candidate.version);
          },
          {
            timeoutMs: 10 * 60_000,
            intervalMs: 2000,
            message: `${failed(ASSUMPTION.updater)}: ${paths.appExe()} is still not ${candidate.version} 10 minutes after the app quit`,
          },
        );
      } catch (error) {
        throw new Error(`${error.message}\n${await installForensics(installerSeen)}`);
      }
      // A quit-time install must not start the app; one that did would hold the single-instance lock.
      const running = await strayAfter([paths.installDir()], 30_000);
      expect(running, 'something runs out of the install dir after the silent install').toEqual([]);
      expect(
        fs.existsSync(path.join(paths.resourcesDir(), MARKER)),
        `${failed(ASSUMPTION.wholesale)}: a file the previous install left in resources/ survived`,
      ).toBe(false);
      expect(
        formatsSnapshot().map(({ name, size }) => ({ name, size })),
        "latex/formats/ does not hold the new build's .fmt",
      ).toEqual(shippedFormats.map(({ name, size }) => ({ name, size })));
    });
  } finally {
    await feed.close();
  }

  await test.step(`${candidate.version} launches with its keys and yt-dlp copy intact`, async () => {
    const { page } = await start();
    await recordBoot('after_update', session, candidate.version);
    expect(readLaunchLog().split('\n')[0], 'launch.log names the wrong version').toContain(
      `FastStudy ${candidate.version} `,
    );
    // Settings is a route like any other once the wall has been passed.
    await page.goto('app://bundle/settings');
    await expect(page.getByTestId('data-root-input')).toBeVisible();
    await expect(page.getByTestId('init-wall')).toHaveCount(0);

    // The wall reads only whether a key is stored; a network failure, rather than "not set in the
    // environment", is what proves the key decrypted into the backend's environment.
    const { db } = services;
    await db.configured();
    await db.createCourse(UPDATE_COURSE);
    await db.createLecture(UPDATE_COURSE, LECTURE);
    await db.putFile(UPDATE_COURSE, LECTURE, 'transcript.txt', fixture('transcript.txt'));
    await openLecture(page, UPDATE_COURSE, LECTURE);
    await expectNetworkFailure(page, UPDATE_COURSE, LECTURE, 'summarize');

    expect(fingerprint(paths.ytdlpCopy()), 'the update touched the yt-dlp copy').toEqual(seeded);
    await stop();
  });
}
