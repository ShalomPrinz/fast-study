import { expect, test } from '@playwright/test';
import { readLaunchLog, readyPorts } from '../lib/app.js';
import { openLecture } from '../lib/lecture.js';
import * as paths from '../lib/paths.js';
import { refusesConnection, strayAfter } from '../lib/processes.js';
import { session, start, stop } from '../lib/session.js';
import { COURSE, LECTURE } from '../lib/suite.js';

export default async function quitNoOrphans() {
  const ports = readyPorts(readLaunchLog());
  expect(ports).toHaveLength(4);
  await stop();

  const strays = await strayAfter([paths.installDir(), paths.stateRoot()], 30_000);
  expect(strays, 'processes outlived the app').toEqual([]);
  for (const { service, port } of ports) {
    expect(await refusesConnection(port), `${service} still holds port ${port}`).toBe(true);
  }

  await test.step('a relaunch skips the init wall', async () => {
    await start();
    // The wall stands in front of every route, so a rendered lecture is the proof it is gone.
    await openLecture(session.page, COURSE, LECTURE);
    await expect(session.page.getByTestId('init-wall')).toHaveCount(0);
  });
}
