import { expect } from '@playwright/test';
import { readLaunchLog, readyPorts } from '../../lib/app.js';
import { evidence } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';
import { healthOf, toolsOf } from '../../lib/services.js';
import { services, start } from '../../lib/session.js';
import { TOOLS } from '../../lib/suite.js';

export default async function boot() {
  // Left running: the native host check needs the bridge file a live `server` keeps.
  await start();
  await expect
    .poll(() =>
      readyPorts(readLaunchLog())
        .map((ready) => ready.service)
        .sort(),
    )
    .toEqual(['auto', 'backend', 'database', 'server']);
  const log = readLaunchLog();
  expect(log.split('\n')[0], 'launch.log names the wrong version').toContain(
    `FastStudy ${paths.macCandidate().version} `,
  );

  const health = await healthOf(services.urls);
  const tools = await toolsOf(services);
  evidence(
    '3. boot, /health and GET /tools',
    [
      log.split('\n')[0],
      ...log.split('\n').filter((line) => /ready on|token key|native host/.test(line)),
      `/health: ${JSON.stringify(health)}`,
      `/tools: ${JSON.stringify(tools, null, 2)}`,
    ].join('\n'),
  );
  for (const [name, answer] of Object.entries(health)) {
    expect(answer.status, `${name} /health`).toBe('ok');
  }
  for (const [name, probed] of Object.entries(tools)) {
    const unusable = Object.entries(probed ?? {})
      .filter(([, result]) => result !== 'ok')
      .map(([tool, result]) => `${tool}: ${result?.code ?? result} (${result?.state})`);
    expect(unusable, `${name} reports tools it cannot run`).toEqual([]);
  }
  const probed = new Set(Object.values(tools).flatMap((entry) => Object.keys(entry ?? {})));
  for (const tool of TOOLS) expect([...probed], `no service probes ${tool}`).toContain(tool);
}
