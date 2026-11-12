import { expect, test } from '@playwright/test';
import { abandon } from '../lib/app.js';
import * as paths from '../lib/paths.js';
import {
  expectAudioUnfinished,
  isJobTool,
  JOB_TOOL_GRACE_MS,
  jobToolsAfterKill,
  longAudioRunning,
  named,
  refusesConnection,
  serviceTree,
  survivorsAfter,
  withDescendants,
} from '../lib/processes.js';
import { forget, session, start } from '../lib/session.js';
import { ASSUMPTION, failed } from '../lib/suite.js';
import { delay } from '../lib/wait.js';
import { runToExit } from '../lib/windows.js';

export default async function launcherCrash() {
  if (!session) await start();
  const { old, main } = await serviceTree();
  const backendProcess = old.find((p) => p.service === 'backend');
  const { ffmpeg, table } = await longAudioRunning(backendProcess);

  // What a crashed launcher must not leave: the frozen services, the Node services (FastStudy.exe
  // as node) and the tools the backend's job holds. yt-dlp, curl and Chromium are an accepted gap.
  const covered = (p) =>
    p.exe.toLowerCase() === paths.servicesExe().toLowerCase() ||
    (p.exe.toLowerCase() === paths.appExe().toLowerCase() && !p.commandLine.includes('--type=')) ||
    isJobTool(p);
  const tracked = withDescendants(table, old).filter(covered);

  // No /T: a crash takes main alone, so whatever dies with it dies of a job, not a tree walk.
  const { code, output } = await runToExit('taskkill', ['/F', '/PID', String(main.pid)], {
    timeoutMs: 30_000,
  });
  expect(code, `taskkill /F /PID ${main.pid} exited ${code}: ${output}`).toBe(0);
  const tools = await jobToolsAfterKill(tracked);
  const crashed = session;
  forget();
  // Main is gone, so trace and app handle are only dropped.
  await Promise.race([abandon(crashed), delay(30_000)]);

  // Services may take their time to go; a surviving one keeps its tools alive, so it is judged first.
  const left = (
    await survivorsAfter(
      tracked.filter((p) => !isJobTool(p)),
      30_000,
    )
  ).filter(covered);
  expect(
    left.filter((p) => !isJobTool(p)).map(named),
    `${failed(ASSUMPTION.launcherJob)}: services outlived main`,
  ).toEqual([]);
  expect(
    [...tools, ...left].map(named),
    `${failed(ASSUMPTION.backendJob)}: a tool outlived the crash by ${JOB_TOOL_GRACE_MS} ms (${named(ffmpeg)} was running)`,
  ).toEqual([]);
  for (const { service, port } of old) {
    expect(await refusesConnection(port), `${service} still holds port ${port}`).toBe(true);
  }

  await test.step('a relaunch boots after the crash', async () => {
    await start();
    await expectAudioUnfinished();
  });
}
