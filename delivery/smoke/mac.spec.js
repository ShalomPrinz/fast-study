import { test } from '@playwright/test';
import { abandon } from './lib/app.js';
import { run, screenshot } from './lib/mac.js';
import * as paths from './lib/paths.js';
import { forget, session } from './lib/session.js';
import quit from './tests/11-quit.js';
import launcherCrash from './tests/12-launcher-crash.js';
import backendDeath from './tests/13-backend-death.js';
import dmgInstall from './tests/mac/01-install.js';
import signatures from './tests/mac/02-signatures.js';
import boot from './tests/mac/03-boot.js';
import ffmpegAudio from './tests/mac/04-ffmpeg.js';
import nativeHost from './tests/mac/05-native-host.js';
import zoomHidden from './tests/mac/06-zoom.js';
import pdf from './tests/mac/08-pdf.js';
import linkage from './tests/mac/09-linkage.js';
import firstRun from './tests/mac/10-first-run.js';
import providerSteps from './tests/mac/11-provider-steps.js';
import update from './tests/mac/99-update.js';

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be a destructuring pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  // The desktop, not the page: what blocks a macOS boot is a system prompt no page shows.
  await screenshot(`failure-${testInfo.title.split('.')[0]}.png`);
});

test.afterAll(async () => {
  await abandon(session);
  forget();
  await run('/usr/bin/pkill', ['-KILL', '-f', paths.macBundle()]);
});

// Only what is Mac-specific; every test builds on the machine state the ones before it left.
test('1. the dmg installs', dmgInstall);
test('2. every Mach-O in the installed bundle verifies', signatures);
test('3. boot, four services healthy, every bundled tool working', boot);
test('4. the bundled ffmpeg writes audio.mp3 with the audio step’s arguments', ffmpegAudio);
test('5. the native host answers through the manifest Chrome reads', nativeHost);
test('6. the zoom browser hides by pid and comes back', zoomHidden);
test(
  '7. first run: the keys are stored encrypted, the data folder is picked, the probes fail offline',
  firstRun,
);
test('8. the provider steps fail on the network, and only there', providerSteps);
test('9. the PDF, for real', pdf);
test('10. quitting leaves no process or port behind', quit);
test('11. a backend death leaves no tool behind, and the restart works', backendDeath);
test('12. every Mach-O links only inside the bundle or the system', linkage);
// Ported tests go above this one: it is expected to fail until electron/ stops detaching services, and a failure skips what follows.
test('13. a launcher crash leaves no service or tool behind', launcherCrash);
// Last, as on Windows: it wipes the bundle and the state root. Ported tests go above it.
test('14. the updater swaps a previous build for the candidate and relaunches', update);
