import { expect, test } from '@playwright/test';
import { readLaunchLog, readyPorts } from '../lib/app.js';
import { recordBoot } from '../lib/bootTiming.js';
import * as paths from '../lib/paths.js';
import { healthOf, toolsOf } from '../lib/services.js';
import { services, session, start } from '../lib/session.js';
import { TOOLS } from '../lib/suite.js';

const PATH_TOOLS = ['curl'];

export default async function boot() {
  await start();
  const { page } = session;
  // The fresh install's first launch is one of the two boots every run records.
  await recordBoot('fresh_install', session, paths.candidate().version);

  // Main navigates only once all four answered /health, and the launch screen is gone by then, so
  // the navigation plus main's four ready lines are what "every row reached ready" is.
  expect(page.url()).toMatch(/^app:\/\/bundle\//);
  // Auto starts beside the database → backend track, so only database-before-backend and server-last hold.
  await expect
    .poll(() => readyPorts(readLaunchLog()).map((ready) => ready.service))
    .toHaveLength(4);
  const order = readyPorts(readLaunchLog()).map((ready) => ready.service);
  expect([...order].sort(), `ready lines: ${order.join(', ')}`).toEqual([
    'auto',
    'backend',
    'database',
    'server',
  ]);
  expect(order.indexOf('database'), `ready lines: ${order.join(', ')}`).toBeLessThan(
    order.indexOf('backend'),
  );
  expect(order.at(-1), `ready lines: ${order.join(', ')}`).toBe('server');

  for (const [name, answer] of Object.entries(await healthOf(services.urls))) {
    expect(answer.status, `${name} /health`).toBe('ok');
  }
  const tools = await toolsOf(services);
  for (const [name, probed] of Object.entries(tools)) {
    // A usable tool is the bare string `ok`, an unusable one a {code, state, params} object, so the
    // offenders are rendered rather than printed raw: `code`/`state` say why the probe failed.
    const unusable = Object.entries(probed ?? {})
      .filter(([, result]) => result !== 'ok')
      .map(([tool, result]) => `${tool}: ${result?.code ?? result} (${result?.state})`);
    expect(unusable, `${name} reports tools it cannot run`).toEqual([]);
  }

  // What the services probe is what bin/ ships: a tool dropped from one side and left on the other
  // is either dead weight in the installer or a feature that only fails on a user's machine.
  const probedTools = Object.values(tools).flatMap((probed) => Object.keys(probed ?? {}));
  expect(
    [...new Set(probedTools)].filter((tool) => !PATH_TOOLS.includes(tool)).sort(),
    'the services probe a different set of tools than resources/bin/ ships',
  ).toEqual([...TOOLS].sort());

  await test.step('every service refuses a request without the launch secret', async () => {
    // A path no service routes: the secret check runs before routing, so 401 rather than 404.
    for (const [name, url] of Object.entries(services.urls)) {
      const { status } = await fetch(`${url}/__smoke`);
      expect(
        status,
        `${name} answered ${status}, so the launcher did not hand it the launch secret`,
      ).toBe(401);
    }
  });
}
