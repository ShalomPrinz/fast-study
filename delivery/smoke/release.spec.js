import { test } from '@playwright/test';
import { abandon } from './lib/app.js';
import { restoreBrowsers } from './lib/browsers.js';
import { forget, session } from './lib/session.js';
import freshInstall from './tests/01-fresh-install.js';
import dllImports from './tests/02-dll-imports.js';
import boot from './tests/03-boot.js';
import firstRun from './tests/04-first-run.js';
import providerSteps from './tests/05-provider-steps.js';
import pdfForReal from './tests/06-pdf.js';
import liveSseUpdate from './tests/07-live-sse.js';
import driveOff from './tests/08-drive-off.js';
import openingPdf from './tests/09-open-pdf.js';
import ytdlpDownload from './tests/10-ytdlp-download.js';
import quitNoOrphans from './tests/11-quit.js';
import launcherCrash from './tests/12-launcher-crash.js';
import backendDeath from './tests/13-backend-death.js';
import hebrewTemp from './tests/14-hebrew-temp.js';
import browserChain from './tests/15-browser-chain.js';
import inPlaceUpdate from './tests/16-update.js';

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be a destructuring pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && session && !session.page.isClosed()) {
    await session.page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
  }
});

test.afterAll(async () => {
  await abandon(session);
  forget();
  restoreBrowsers();
});

// Each body is a file in tests/; every test builds on the machine state the ones before it left.
test('1. fresh install', freshInstall);
test('2. every shipped binary imports only what ships or what Windows has', dllImports);
test('3. boot', boot);
test('4. first run', firstRun);
test('5. the provider steps fail on the network, and only there', providerSteps);
test('6. the PDF, for real', pdfForReal);
test('7. a live SSE update', liveSseUpdate);
test('8. drive off', driveOff);
test('9. opening a PDF', openingPdf);
test('10. a yt-dlp download merges its streams with the bundled ffmpeg', ytdlpDownload);
test('11. quit, no orphans', quitNoOrphans);
test('12. a launcher crash leaves no service or tool behind', launcherCrash);
test('13. a backend death leaves no tool behind, and the restart works', backendDeath);
test('14. the tools run under a Hebrew temp path', hebrewTemp);
test('15. the browser chain, both ends', browserChain);
test('16. an in-place update', inPlaceUpdate);
