import net from 'node:net';
import path from 'node:path';
import { expect } from '@playwright/test';
import { readLaunchLog, readyPorts } from './app.js';
import { longToneVideo } from './media.js';
import * as paths from './paths.js';
import { services } from './session.js';
import { COURSE } from './suite.js';
import { delay, waitFor } from './wait.js';
import { listeners, processTable, strayProcesses } from './windows.js';

const LONG_LECTURE = 'Long Tone Lecture';

let longVideoPut = false;

/** Processes still running out of any of `dirs`, once they have had `graceMs` to exit. */
export async function strayAfter(dirs, graceMs) {
  const deadline = Date.now() + graceMs;
  for (;;) {
    const strays = await strayProcesses(dirs);
    if (!strays.length || Date.now() > deadline) return strays;
    await delay(1000);
  }
}

export function refusesConnection(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

/** A process as a failure names it: pid, image, command line, and the service port it held, if any. */
export function named(p) {
  const held = p.service ? ` — ${p.service} on port ${p.port}` : '';
  return `pid ${p.pid} ${p.name} (${p.commandLine || p.exe || 'no command line'})${held}`;
}

/** The services main runs: its direct children out of the install dir, minus Electron's own
 *  `--type=` helpers (renderer, GPU, crashpad) — `faststudy-services.exe` twice and `FastStudy.exe` as node twice. */
export function serviceChildren(table, mainPid) {
  const prefix = path.join(paths.installDir(), path.sep).toLowerCase();
  return table.filter(
    (p) =>
      p.ppid === mainPid &&
      p.exe.toLowerCase().startsWith(prefix) &&
      !p.commandLine.includes('--type='),
  );
}

/** `roots` and every process descended from them in `table`. */
export function withDescendants(table, roots) {
  const found = [...roots];
  for (let i = 0; i < found.length; i++) {
    for (const child of table) {
      const own = child.ppid === found[i].pid && child.created >= found[i].created;
      if (own && !found.includes(child)) found.push(child);
    }
  }
  return found;
}

/** The four services as their ready ports' owners, each `{ ...process, service, port }`, and main
 *  as their one parent — proven to be the installed exe without `--type=` and to have no other service child. */
export async function serviceTree() {
  const ready = readyPorts(readLaunchLog());
  expect(ready, `ready lines: ${JSON.stringify(ready)}`).toHaveLength(4);
  const table = await processTable();
  const owners = await listeners(ready.map(({ port }) => port));
  const old = ready.map(({ service, port }) => {
    const pid = owners.find((owner) => owner.port === port)?.pid;
    const found = table.find((p) => p.pid === pid);
    expect(found, `nothing listens on ${service}'s port ${port}`).toBeTruthy();
    return { ...found, service, port };
  });
  // Main is the ready ports' owners' one parent, not Playwright's pid, which is main's parent here.
  const parents = [...new Set(old.map((p) => p.ppid))];
  const parentsNamed = parents
    .map((pid) => named(table.find((p) => p.pid === pid) ?? { pid, name: '(exited)' }))
    .join('; ');
  expect(
    parents,
    `the ready ports' owners (${old.map(named).join('; ')}) do not share one parent: ${parentsNamed}`,
  ).toHaveLength(1);
  const main = table.find((p) => p.pid === parents[0]);
  expect(
    main &&
      main.exe.toLowerCase() === paths.appExe().toLowerCase() &&
      !main.commandLine.includes('--type='),
    `the ready ports' owners (${old.map(named).join('; ')}) have parent ${parentsNamed}, not ${paths.appExe()} without --type=`,
  ).toBe(true);
  const children = serviceChildren(table, main.pid);
  expect(
    old.map((p) => p.pid).sort(),
    `the ready ports' owners (${old.map(named).join('; ')}) are not main's service children (${children.map(named).join('; ')})`,
  ).toEqual(children.map((p) => p.pid).sort());
  return { old, main };
}

const JOB_TOOLS = ['ffmpeg', 'pandoc', 'tectonic'];

/** A bundled tool the backend's job holds, by image path under `resources/bin/`. */
export function isJobTool(p) {
  return JOB_TOOLS.some(
    (tool) => p.exe.toLowerCase() === path.join(paths.binDir(), `${tool}.exe`).toLowerCase(),
  );
}

/** Start the audio step on the six-hour tone and wait until its ffmpeg runs under `backendProcess`.
 *  Answers that ffmpeg and the process table it was found in. */
export async function longAudioRunning(backendProcess) {
  const { db, api } = services;
  if (!longVideoPut) {
    await db.putVideo(COURSE, LONG_LECTURE, await longToneVideo());
    longVideoPut = true;
  }
  await api.startStep(COURSE, LONG_LECTURE, 'audio');
  return waitFor(
    async () => {
      const table = await processTable();
      const ffmpeg = table.find(
        (p) =>
          p.ppid === backendProcess.pid &&
          p.created >= backendProcess.created &&
          p.exe.toLowerCase() === path.join(paths.binDir(), 'ffmpeg.exe').toLowerCase() &&
          p.commandLine.includes('-vn'),
      );
      return ffmpeg ? { ffmpeg, table } : null;
    },
    {
      timeoutMs: 60_000,
      intervalMs: 500,
      message: `the audio step on ${LONG_LECTURE} never ran ffmpeg under ${named(backendProcess)}`,
    },
  );
}

/** A step that finished uploads its output, so an `audio.mp3` means ffmpeg ended before the kill. */
export async function expectAudioUnfinished() {
  expect(
    await services.db.exists(COURSE, LONG_LECTURE, 'audio.mp3'),
    `the audio step on ${LONG_LECTURE} finished before the kill, so this check proved nothing; lengthen longToneVideo`,
  ).toBe(false);
}

/** KILL_ON_JOB_CLOSE ends a job's tools the moment its owner dies, while an orphan runs on until its
 *  encode ends — tens of seconds on the long tone — so a tool is judged within seconds, never waited out. */
export const JOB_TOOL_GRACE_MS = 5_000;

/** The job tools among `tracked` (pid and start time, from before the kill) still running
 *  `JOB_TOOL_GRACE_MS` after it. Called right after the kill, before anything else can wait. */
export async function jobToolsAfterKill(tracked) {
  return (await survivorsAfter(tracked.filter(isJobTool), JOB_TOOL_GRACE_MS)).filter(isJobTool);
}

/** `survivorsOf(tracked)` until it is empty or `graceMs` has passed. */
export async function survivorsAfter(tracked, graceMs) {
  let left = await survivorsOf(tracked);
  for (const deadline = Date.now() + graceMs; left.length && Date.now() < deadline;) {
    await delay(1000);
    left = await survivorsOf(tracked);
  }
  return left;
}

/** What of `tracked` still runs, plus any process born later under a tracked pid — the tree a
 *  dead parent's orphans keep naming. A pid Windows reused for a stranger is matched by start time. */
async function survivorsOf(tracked) {
  const now = await processTable();
  const same = (a, b) => a.pid === b.pid && a.created === b.created;
  const survivors = tracked.filter((t) => now.some((p) => same(p, t)));
  const orphans = now.filter((p) => {
    const parent = tracked.find((t) => t.pid === p.ppid);
    if (!parent || p.created < parent.created || tracked.some((t) => same(t, p))) return false;
    return !now.some((q) => q.pid === parent.pid && q.created !== parent.created);
  });
  return [...survivors, ...orphans];
}
