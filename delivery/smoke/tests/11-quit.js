import { expect, test } from '@playwright/test';
import { readLaunchLog, readyPorts } from '../lib/app.js';
import { openLecture } from '../lib/lecture.js';
import * as paths from '../lib/paths.js';
import { refusesConnection, strayAfter } from '../lib/processes.js';
import { evidence } from '../lib/platform.js';
import { session, start, stop } from '../lib/session.js';
import { COURSE, LECTURE } from '../lib/suite.js';

export default async function quitNoOrphans() {
  const ports = readyPorts(readLaunchLog());
  expect(ports).toHaveLength(4);
  await stop();

  const strays = await strayAfter([paths.installDir(), paths.stateRoot()], 30_000);
  const held = [];
  for (const { service, port } of ports) {
    if (!(await refusesConnection(port))) held.push(`${service} still holds port ${port}`);
  }
  evidence(
    'quit: what outlived the window closing',
    `ports ${ports.map((p) => `${p.service}:${p.port}`).join(' ')}\nstray processes: ${JSON.stringify(strays)}\nports still held: ${JSON.stringify(held)}`,
  );
  expect(strays, 'processes outlived the app').toEqual([]);
  expect(held, 'a service port outlived the app').toEqual([]);

  await test.step('a relaunch skips the init wall', async () => {
    await start();
    // The wall stands in front of every route, so a rendered lecture is the proof it is gone.
    await openLecture(session.page, COURSE, LECTURE);
    await expect(session.page.getByTestId('init-wall')).toHaveCount(0);
  });
}
