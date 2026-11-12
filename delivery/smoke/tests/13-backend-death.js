import fs from 'node:fs';
import { expect } from '@playwright/test';
import { readLaunchLog, readyPorts } from '../lib/app.js';
import { openLecture } from '../lib/lecture.js';
import * as paths from '../lib/paths.js';
import {
  expectAudioUnfinished,
  JOB_TOOL_GRACE_MS,
  jobToolsAfterKill,
  longAudioRunning,
  named,
  serviceChildren,
  serviceTree,
  survivorsAfter,
  withDescendants,
} from '../lib/processes.js';
import { healthOf } from '../lib/services.js';
import { bind, services, session, start } from '../lib/session.js';
import { ASSUMPTION, COURSE, failed, LECTURE } from '../lib/suite.js';
import { waitFor } from '../lib/wait.js';
import { listeners, processTable } from '../lib/windows.js';

export default async function backendDeath() {
  if (!session) await start();
  const { page } = session;
  const killed = 'backend';
  const { old, main } = await serviceTree();
  const mainPid = main.pid;
  const victim = old.find((p) => p.service === killed);
  // Killed mid-extraction, so the restart proves what the backend's own job does with its ffmpeg.
  const { ffmpeg, table } = await longAudioRunning(victim);
  // Each service's process is the one listening on its ready port; what it spawned is tracked too.
  const tracked = withDescendants(table, old);

  // Task Manager's End task: TerminateProcess, which is what Node's kill is on Windows.
  process.kill(victim.pid, 'SIGKILL');
  expect(
    (await jobToolsAfterKill(tracked)).map(named),
    `${failed(ASSUMPTION.backendJob)}: a tool outlived the killed backend by ${JOB_TOOL_GRACE_MS} ms (${named(ffmpeg)} was running)`,
  ).toEqual([]);
  await waitFor(() => readLaunchLog().includes(`[main] ${killed} stopped unexpectedly`), {
    timeoutMs: 30_000,
    message: `launch.log never reported ${named(victim)} stopped after a hard kill`,
  });

  // The bridge's own call; the banner that offers it is the harness's to prove.
  await page
    .evaluate(() => window.faststudy.services.restart())
    .catch((error) => {
      // The restart navigates to the launch screen, which can beat the evaluate's answer back.
      if (!/context was destroyed/i.test(error.message)) throw error;
    });
  const sinceRestart = () => {
    const log = readLaunchLog();
    const at = log.indexOf('[main] restart requested');
    return at < 0 ? '' : log.slice(at);
  };
  const after = await waitFor(
    () => {
      const log = sinceRestart();
      if (log.includes('[main] boot failed')) throw new Error(`the restart's boot failed:\n${log}`);
      const ready = readyPorts(log);
      return ready.length === 4 && log.includes('[main] app loaded app://bundle/') ? ready : null;
    },
    {
      timeoutMs: 180_000,
      message: () =>
        `the restart did not reboot four services and reload the app; launch.log since it was requested:\n${sinceRestart() || '(no restart requested line)'}`,
    },
  );
  await page.waitForURL((url) => url.protocol === 'app:' && url.host === 'bundle');
  await bind();

  const left = await survivorsAfter(tracked, 30_000);
  expect(left.map(named), 'processes from before the restart outlived it').toEqual([]);
  await expectAudioUnfinished();

  const now = await processTable();
  const running = serviceChildren(now, mainPid);
  expect(running.map(named), 'main runs other than four service processes').toHaveLength(4);
  // An old port may be closed or reissued by bind(0) to a new service; any other listener leaked.
  const runningPids = running.map((p) => p.pid);
  for (const { port, pid } of await listeners(old.map((p) => p.port))) {
    const holder = now.find((p) => p.pid === pid) ?? { pid, name: '(exited)' };
    expect(
      runningPids,
      `old port ${port} is held by ${named(holder)}, not a new service`,
    ).toContain(pid);
  }
  const newOwners = await listeners(after.map(({ port }) => port));
  for (const { service, port } of after) {
    const pid = newOwners.find((owner) => owner.port === port)?.pid;
    expect(
      running.map((p) => p.pid),
      `${service}'s new port ${port} is held by pid ${pid ?? 'nobody'}, not one of main's service children: ${running.map(named).join('; ')}`,
    ).toContain(pid);
  }
  expect(new Set(newOwners.map(({ pid }) => pid)).size, 'two services share a process').toBe(4);

  // The reloaded page reads the new ports off the bridge, and the app answers on them.
  expect(
    Object.values(services.urls)
      .map((url) => Number(new URL(url).port))
      .sort(),
    "the reloaded bridge does not name the restart's ports",
  ).toEqual(after.map(({ port }) => port).sort());
  for (const [name, answer] of Object.entries(await healthOf(services.urls))) {
    expect(answer.status, `${name} /health after the restart`).toBe('ok');
  }
  // The native host reads the server's port off bridge.json, which the restart must rewrite.
  const serverPort = after.find(({ service }) => service === 'server').port;
  await waitFor(
    () => {
      try {
        return JSON.parse(fs.readFileSync(paths.bridgeFile(), 'utf8')).port === serverPort;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 30_000,
      message: () => {
        let held;
        try {
          held = `port ${JSON.parse(fs.readFileSync(paths.bridgeFile(), 'utf8')).port}`;
        } catch (error) {
          held = error.message;
        }
        return `${paths.bridgeFile()} does not name the restart's server port ${serverPort}: ${held}`;
      },
    },
  );
  await openLecture(page, COURSE, LECTURE);
}
