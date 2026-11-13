import { defineConfig } from '@playwright/test';

// The macOS suite: the same one worker and one ordered file as playwright.config.js, over mac.spec.js.
export default defineConfig({
  testDir: '.',
  testMatch: 'mac.spec.js',
  outputDir: 'test-results',
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  globalTimeout: 50 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
});
