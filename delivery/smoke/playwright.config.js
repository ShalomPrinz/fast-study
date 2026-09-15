import { defineConfig } from '@playwright/test';

// One worker, one ordered file: every check builds on the machine state the one before it left —
// an installed app, a first run, a lecture — so nothing here can run in parallel or alone.
export default defineConfig({
  testDir: '.',
  testMatch: 'release.spec.js',
  outputDir: 'test-results',
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  globalTimeout: 120 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
});
