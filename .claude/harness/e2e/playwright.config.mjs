// E2E specs against one live harness stack (HARNESS_DIR); `setup.mjs` starts it, so no webServer.
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appUrl } from '../lib/browser.mjs';
import { harness } from './fixtures.mjs';

export default defineConfig({
  testDir: path.dirname(fileURLToPath(import.meta.url)),
  // One stack and its shared data: specs run one at a time, and a flake is a bug, not a retry.
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  outputDir: path.join(harness.evidence, 'e2e-results'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(harness.evidence, 'e2e-report') }],
  ],
  use: {
    baseURL: appUrl(),
    viewport: { width: 1400, height: 900 },
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
