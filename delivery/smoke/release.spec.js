import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { abandon, bridge, launch, quit, readLaunchLog, readyPorts, waitForApp } from './lib/app.js';
import { completeInitWall, PLACEHOLDER_KEYS } from './lib/firstRun.js';
import { toneVideo } from './lib/media.js';
import { proveOfflineEnforcement } from './lib/offline.js';
import * as paths from './lib/paths.js';
import { unresolvedImports } from './lib/pe.js';
import { carriesPhrase, pdfText } from './lib/pdf.js';
import {
  backend,
  database,
  healthOf,
  NETWORK_FAILURE,
  NOT_A_NETWORK_FAILURE,
} from './lib/services.js';
import { pointUpdaterAt, serveUpdateFeed } from './lib/updateServer.js';
import { delay, waitFor } from './lib/wait.js';
import {
  blockOutbound,
  enableFirewall,
  holdExclusive,
  processesNamed,
  productVersion,
  renameAside,
  runToExit,
  stopProcesses,
  strayProcesses,
} from './lib/windows.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

const COURSE = 'Smoke Course';
const LECTURE = 'Tone Lecture';
const LIVE_LECTURE = 'Live Update Lecture';
const SECOND_LECTURE = 'No Browser Lecture';
const TEMP_LECTURE = 'Hebrew Temp Lecture';
const UPDATE_COURSE = 'Update Course';
// A line of fixtures/summary.md: Hebrew only, so a missing Hebrew font cannot drop it unnoticed.
const PDF_PHRASE = 'רדיוס ההתכנסות נתון על ידי נוסחת קושי הדמר';
// Every binary resources/bin/ ships, which is every tool the services probe but curl — Windows
// ships curl.exe, so lib/tools resolves it off PATH instead.
const TOOLS = ['ffmpeg', 'pandoc', 'tectonic', 'yt-dlp'];
const PATH_TOOLS = ['curl'];
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const MARKER = 'faststudy-smoke-marker.txt';

// What only a Windows run can prove, named in the failure wherever one of them breaks.
const ASSUMPTION = {
  nsis: 'NSIS /S performs the per-user install with no prompt',
  rename:
    "renaming a browser's install dir is equivalent to uninstalling it for Playwright's channel resolve",
  updater: 'electron-updater installs an unsigned build over an unsigned build from a generic provider',
  wholesale: 'an electron-updater install preserves nothing in the install directory',
};
const failed = (assumption) => `assumption failed: ${assumption}`;

test.describe.configure({ mode: 'serial' });

let session = null;
let services = null;
let toneBytes = null;
const asides = [];

const byTestId = (page, id, attributes = {}) =>
  page.locator(
    `[data-testid="${id}"]` +
      Object.entries(attributes)
        .map(([name, value]) => `[data-${name}="${value}"]`)
        .join(''),
  );

/** Launch, wait for the four services, and bind the service clients to this launch's bridge. */
async function start(env) {
  session = await launch(env);
  await waitForApp(session);
  const reached = await bridge(session.page);
  services = { urls: reached.urls, db: database(reached), api: backend(reached) };
  return session;
}

async function stop() {
  const closing = session;
  session = null;
  services = null;
  if (closing) await quit(closing);
}

async function openLecture(page, course, lecture) {
  await page.goto(`app://bundle/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`);
  await expect(byTestId(page, 'lecture-view', { course, lecture, kind: 'lecture' })).toBeVisible();
  await expect(byTestId(page, 'lecture', { course, lecture })).toBeVisible();
}

async function tone() {
  toneBytes ??= await toneVideo();
  return toneBytes;
}

/** Run one provider step alone and prove it died on the network: not a crash, not an import
 *  error, not a missing key, and the backend still up. Only that step ran, so the error is its own. */
async function expectNetworkFailure(page, course, lecture, step) {
  const error = await services.api.runStep(course, lecture, step);
  expect(error, `${step} succeeded, so a provider answered`).not.toBeNull();
  expect(error, `${step} failed, but not on the network`).toMatch(NETWORK_FAILURE);
  expect(error, `${step} failed on something a network block cannot cause`).not.toMatch(
    NOT_A_NETWORK_FAILURE,
  );
  // The backend's untranslated prose — the one visible text the suite reads.
  await expect(page.getByTestId('lecture-error-message')).toHaveText(error);
  await expect(byTestId(page, 'step-status', { step })).toHaveAttribute('data-status', 'failed');
  expect((await services.api.health()).status, 'the backend stopped answering').toBe('ok');
}

/** Processes still running out of any of `dirs`, once they have had `graceMs` to exit. */
async function strayAfter(dirs, graceMs) {
  const deadline = Date.now() + graceMs;
  for (;;) {
    const strays = await strayProcesses(dirs);
    if (!strays.length || Date.now() > deadline) return strays;
    await delay(1000);
  }
}

function refusesConnection(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

/** Each existing install dir Playwright's channel resolve looks in, per its fixed Windows paths. */
function channelDirs(channel) {
  const vendor = channel === 'chrome' ? ['Google', 'Chrome'] : ['Microsoft', 'Edge'];
  return [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
    .filter(Boolean)
    .map((base) => path.join(base, ...vendor, 'Application'))
    .filter((dir) => fs.existsSync(dir));
}

async function launchable(channel) {
  try {
    const browser = await chromium.launch({ channel, headless: true, timeout: 60_000 });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/** Take a browser away by renaming its install dir, and measure that Playwright agrees it is gone. */
async function removeBrowser(channel) {
  expect(await launchable(channel), `the runner image has no ${channel} to take away`).toBe(true);
  await stopProcesses([channel]);
  const dirs = channelDirs(channel);
  for (const dir of dirs) asides.push([dir, await renameAside(dir)]);
  expect(
    await launchable(channel),
    `${failed(ASSUMPTION.rename)}: Playwright still launches ${channel} with ${dirs.join(', ')} renamed`,
  ).toBe(false);
}

function restoreBrowsers() {
  for (const [original, aside] of asides.splice(0).reverse()) {
    try {
      fs.renameSync(aside, original);
    } catch (error) {
      console.error(`could not restore ${original}: ${error.message}`);
    }
  }
}

function fingerprint(file) {
  return {
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    mtimeMs: fs.statSync(file).mtimeMs,
  };
}

/** The first three components: rcedit stamps a four-component ProductVersion, so the exe an 0.1.0
 *  installer wrote reports 0.1.0.0. */
function semverOf(version) {
  return version.trim().split('.').slice(0, 3).join('.');
}

/** What an update that never installed leaves behind, ending with the decisive probe: running the
 *  pending installer here separates a failing installer from a quit-time spawn that never ran. */
async function installForensics(installerSeen, version) {
  const exe = paths.appExe();
  const pending = paths.pendingInstaller(version);
  const lines = [
    `a process snapshot ${installerSeen ? 'caught an installer while waiting' : 'never caught an installer, which is the usual case'}`,
    `${exe} reports ProductVersion ${await productVersion(exe).catch((error) => `unreadable: ${error.message}`)}`,
    `${pending} ${fs.existsSync(pending) ? 'is still there' : 'is gone'}`,
  ];
  const log = path.join(paths.installDir(), 'install.log');
  if (fs.existsSync(log)) {
    lines.push(`tail of ${log}:`, fs.readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'));
  }
  if (fs.existsSync(pending)) {
    const run = await runToExit(pending, ['--updated', '/S'], {
      timeoutMs: INSTALL_TIMEOUT_MS,
      onTimeout: `${pending} --updated /S was still running after 5 minutes`,
    }).catch((error) => ({ code: 'no exit', output: error.message }));
    lines.push(`running it here exited ${run.code}: ${run.output.trim() || '(no output)'}`);
  }
  return lines.join('\n');
}

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be a destructuring pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && session && !session.page.isClosed()) {
    await session.page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
  }
});

test.afterAll(async () => {
  await abandon(session);
  session = null;
  restoreBrowsers();
});

test('1. fresh install', async () => {
  expect(process.platform, 'the smoke suite drives an installed Windows build').toBe('win32');
  const { installer } = paths.candidate();

  await test.step('the silent installer finishes a per-user install', async () => {
    const { code, output } = await runToExit(installer, ['/S'], {
      timeoutMs: INSTALL_TIMEOUT_MS,
      onTimeout: `${failed(ASSUMPTION.nsis)}: ${installer} /S was still running after 5 minutes`,
    });
    expect(code, `the installer exited ${code}: ${output}`).toBe(0);
    expect(fs.existsSync(paths.appExe()), `${failed(ASSUMPTION.nsis)}: no ${paths.appExe()}`).toBe(
      true,
    );
  });

  await test.step("resources/ matches electron/docs/BOOT.md's packaged tree", async () => {
    const shipped = [
      'services/services.exe',
      // The one Google API discovery document services.spec keeps, under PyInstaller's one-dir
      // contents directory. Missing, Drive upload fails on a user's machine and nowhere earlier.
      'services/_internal/googleapiclient/discovery_cache/documents/drive.v3.json',
      'auto/app.js',
      'server/src/index.js',
      'frontend/index.html',
      'latex/bundles',
      // Not in the tree, but what the update check rewrites: electron-builder's publish config.
      'app-update.yml',
    ];
    for (const entry of shipped) {
      expect(fs.existsSync(path.join(paths.resourcesDir(), entry)), `resources/${entry}`).toBe(true);
    }
    // bin/ as a set, not as existence checks: a binary nothing spawns any more still installs
    // cleanly, and its only symptom is the installer's size.
    expect(
      fs.readdirSync(paths.binDir()).sort(),
      'resources/bin/ does not hold exactly the shipped tools',
    ).toEqual(TOOLS.map((tool) => `${tool}.exe`).sort());

    const bundles = fs.readdirSync(path.join(paths.resourcesDir(), 'latex', 'bundles'));
    expect(bundles.length, 'resources/latex/bundles is empty').toBeGreaterThan(0);
    expect(fs.existsSync(paths.formatsDir()), 'latex/formats/ shipped; it is per-machine').toBe(false);
  });

  await test.step('every shipped program is blocked from the network', async () => {
    await enableFirewall();
    const bins = fs
      .readdirSync(paths.binDir())
      .filter((name) => name.endsWith('.exe'))
      .map((name) => path.join(paths.binDir(), name));
    await blockOutbound([paths.appExe(), paths.servicesExe(), ...bins, paths.ytdlpCopy()]);
  });

  await test.step('loopback still works under the block, and nothing else does', () =>
    proveOfflineEnforcement(),
  );
});

test('2. every shipped binary imports only what ships or what Windows has', () => {
  // The runner image carries VC++ runtimes a user's PC may not, so read the imports rather than
  // trusting that everything loads here. DLLs loaded at runtime (LoadLibrary, ctypes) are not covered.
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const { scanned, failures } = unresolvedImports(paths.installDir(), system32);
  expect(scanned, 'no PE file under the install dir parsed; the import reader is broken').toBeGreaterThan(0);
  expect(
    failures.map(({ file, missing }) => `${file}: ${missing.join(', ')}`),
    'imports neither shipped nor a non-redistributable System32 DLL',
  ).toEqual([]);
});

test('3. boot', async () => {
  await start();
  const { page } = session;

  // Main navigates only once all four answered /health, and the launch screen is gone by then, so
  // the navigation plus main's four ready lines are what "every row reached ready" is.
  expect(page.url()).toMatch(/^app:\/\/bundle\//);
  await expect
    .poll(() => readyPorts(readLaunchLog()).map((ready) => ready.service))
    .toEqual(['database', 'backend', 'auto', 'server']);

  const health = await waitFor(
    async () => {
      const answers = await healthOf(services.urls);
      const probed = Object.entries(answers).every(
        ([name, answer]) => name === 'database' || Object.keys(answer.tools ?? {}).length > 0,
      );
      return probed ? answers : null;
    },
    { timeoutMs: 60_000, message: 'a service never finished its boot-time tool probe' },
  );
  for (const [name, answer] of Object.entries(health)) {
    expect(answer.status, `${name} /health`).toBe('ok');
    const unusable = Object.entries(answer.tools ?? {}).filter(([, state]) => state !== 'ok');
    expect(unusable, `${name} reports tools it cannot run`).toEqual([]);
  }

  // What the services probe is what bin/ ships: a tool dropped from one side and left on the other
  // is either dead weight in the installer or a feature that only fails on a user's machine.
  const probedTools = Object.values(health).flatMap((answer) => Object.keys(answer.tools ?? {}));
  expect(
    [...new Set(probedTools)].filter((tool) => !PATH_TOOLS.includes(tool)).sort(),
    'the services probe a different set of tools than resources/bin/ ships',
  ).toEqual([...TOOLS].sort());

  await test.step('every service refuses a request without the launch secret', async () => {
    // A path no service routes: the secret check runs before routing, so 401 rather than 404.
    for (const [name, url] of Object.entries(services.urls)) {
      const { status } = await fetch(`${url}/__smoke`);
      expect(status, `${name} answered ${status}, so the launcher did not hand it the launch secret`).toBe(
        401,
      );
    }
  });
});

test('4. first run', async () => {
  const root = paths.dataRoot('data');
  await completeInitWall(session.page, root);

  const text = fs.readFileSync(paths.settingsFile(), 'utf8');
  const stored = JSON.parse(text);
  for (const [provider, key] of Object.entries(PLACEHOLDER_KEYS)) {
    expect(text.includes(key), `the ${provider} key sits in settings.json in the clear`).toBe(false);
    const field = stored[`${provider}_api_key`];
    expect(typeof field === 'string' && field.length > 0, `no ${provider} key was stored`).toBe(true);
    expect(
      Buffer.from(field, 'base64').includes(Buffer.from(key)),
      `the ${provider} key is only base64-encoded`,
    ).toBe(false);
  }
  expect(stored.data_root).toBe(root);
  await services.db.configured();
});

test('5. the provider steps fail on the network, and only there', async () => {
  const { page } = session;
  const { db, api } = services;
  await db.createCourse(COURSE);
  await db.putVideo(COURSE, LECTURE, await tone());
  await openLecture(page, COURSE, LECTURE);

  await test.step('audio extraction runs for real', async () => {
    expect(await api.runStep(COURSE, LECTURE, 'audio'), 'the audio step failed').toBeNull();
    expect(await db.exists(COURSE, LECTURE, 'audio.mp3')).toBe(true);
  });
  await test.step('transcribe fails on the network', () =>
    expectNetworkFailure(page, COURSE, LECTURE, 'transcribe'),
  );
  await db.putFile(COURSE, LECTURE, 'transcript.txt', fixture('transcript.txt'));
  await test.step('summarize fails on the network over the fixed transcript', () =>
    expectNetworkFailure(page, COURSE, LECTURE, 'summarize'),
  );
});

test('6. the PDF, for real', async () => {
  const { page } = session;
  const { db, api } = services;
  expect(fs.existsSync(paths.formatsDir()), 'latex/formats/ existed before any render').toBe(false);
  await db.putSummary(COURSE, LECTURE, fixture('summary.md').toString('utf8'));

  expect(await api.runStep(COURSE, LECTURE, 'pdf'), 'the PDF step failed').toBeNull();
  const pdf = (await db.entry(COURSE, LECTURE)).files['summary.pdf'];
  expect(pdf.exists, 'no summary.pdf').toBe(true);
  expect(pdf.warning, 'the render left a .pdf_warning').toBeUndefined();
  const formats = fs.existsSync(paths.formatsDir()) ? fs.readdirSync(paths.formatsDir()) : [];
  expect(formats.length, 'the first render built nothing under latex/formats/').toBeGreaterThan(0);

  const text = await pdfText(await db.bytes(COURSE, LECTURE, 'summary.pdf'));
  expect(carriesPhrase(text, PDF_PHRASE), 'summary.pdf dropped glyphs of the fixed summary').toBe(
    true,
  );
  await expect(byTestId(page, 'step-status', { step: 'pdf' })).toHaveAttribute('data-status', 'done');
});

test('7. a live SSE update', async () => {
  const { page } = session;
  const { db, api } = services;
  await db.putVideo(COURSE, LIVE_LECTURE, await tone());
  await openLecture(page, COURSE, LIVE_LECTURE);
  const audio = byTestId(page, 'step-status', { step: 'audio' });
  await expect(audio).toHaveAttribute('data-status', 'pending');

  // Lives exactly as long as this document: a reload or a navigation drops it.
  await page.evaluate(() => {
    window.__smokeSameDocument = true;
  });
  expect(await api.runStep(COURSE, LIVE_LECTURE, 'audio'), 'the audio step failed').toBeNull();
  await expect(audio).toHaveAttribute('data-status', 'done');
  expect(await page.evaluate(() => window.__smokeSameDocument), 'the page reloaded').toBe(true);
});

test('8. drive off', async () => {
  const { page } = session;
  const { db, api } = services;
  await openLecture(page, COURSE, LECTURE);
  await expect(byTestId(page, 'step-status', { step: 'pdf' })).toHaveAttribute('data-status', 'done');
  await expect(byTestId(page, 'step-status', { step: 'drive' })).toHaveCount(0);

  expect(await api.runPipeline(COURSE, LECTURE)).toEqual({ status: 'started' });
  // A run with nothing left never shows in flight, so a drive step would have to appear inside a
  // window: watch one long enough for it to start.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { in_flight: inFlight } = await api.status();
    const mine = inFlight.filter((entry) => entry.course === COURSE && entry.lecture === LECTURE);
    expect(mine, 'the pipeline ran a step past the PDF').toEqual([]);
    await expect(page.getByTestId('drive-consent-modal')).toHaveCount(0);
    await delay(500);
  }
  expect(await db.exists(COURSE, LECTURE, 'drive_url.txt'), 'a Drive upload happened').toBe(false);
});

test('9. opening a PDF', async () => {
  const { page } = session;
  const { db, api } = services;
  await openLecture(page, COURSE, LECTURE);

  await test.step('the open control resolves through the IPC path without an error toast', async () => {
    await page.getByTestId('lecture-actions-menu').click();
    await page.getByTestId('open-pdf').click();
    // `shell.openPath` answers asynchronously and a failure's only surface is the toast.
    await delay(5_000);
    await expect(
      page.locator('.Toastify__toast--error'),
      'opening summary.pdf raised an error toast; a runner with no .pdf handler fails here too',
    ).toHaveCount(0);
  });

  await test.step('a PDF held exclusively renders the locked-file message', async () => {
    // Whatever the shell opened the PDF in would hold its own handle and block ours.
    await stopProcesses(['msedge', 'AcroRd32', 'Acrobat']);
    const file = await db.path(COURSE, LECTURE, 'summary.pdf');
    const lock = await waitFor(() => holdExclusive(file).catch(() => null), {
      timeoutMs: 60_000,
      intervalMs: 2000,
      message: `could not hold ${file} exclusively; whatever opened it still has it`,
    });
    try {
      const error = await api.runStep(COURSE, LECTURE, 'pdf');
      expect(error, 'the PDF step wrote over a locked summary.pdf').not.toBeNull();
      // database/'s wording for a Windows sharing violation, which the backend passes through.
      expect(error).toContain('summary.pdf is open in another program');
      await expect(page.getByTestId('lecture-error-message')).toHaveText(error);
    } finally {
      await lock.release();
    }
  });
});

test('10. quit, no orphans', async () => {
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
});

test('11. the tools run under a Hebrew temp path', async () => {
  await stop();
  // Hebrew and a space in the dir every service spawns its tools in, as a Windows username can put in %TEMP%.
  const folder = 'טמפ עברי';
  const temp = path.join(paths.workDir(), folder);
  fs.mkdirSync(temp, { recursive: true });
  // TMPDIR too: Python's tempfile reads it ahead of TEMP, and a runner shell may set it.
  await start({ TEMP: temp, TMP: temp, TMPDIR: temp });
  const { db, api } = services;
  const broke = `a tool breaks on the non-ASCII temp path ${temp}`;

  /** Run one step while watching the temp folder: each step's workspace is a tempdir made directly in it. */
  async function runInTemp(step) {
    const entries = new Set();
    const watcher = fs.watch(temp, (_, name) => name && entries.add(name));
    try {
      expect(await api.runStep(COURSE, TEMP_LECTURE, step), `the ${step} step failed: ${broke}`).toBeNull();
    } finally {
      watcher.close();
    }
    expect(
      entries.size,
      `the ${step} step made nothing in ${temp}: the service ignored TEMP, so this check proved nothing`,
    ).toBeGreaterThan(0);
  }

  await db.putVideo(COURSE, TEMP_LECTURE, await tone());
  await runInTemp('audio');
  await db.putSummary(COURSE, TEMP_LECTURE, fixture('summary.md').toString('utf8'));
  await runInTemp('pdf');

  const pdf = (await db.entry(COURSE, TEMP_LECTURE)).files['summary.pdf'];
  expect(pdf.exists, `no summary.pdf: ${broke}`).toBe(true);
  expect(pdf.warning, `the render left a .pdf_warning: ${broke}`).toBeUndefined();
  const text = await pdfText(await db.bytes(COURSE, TEMP_LECTURE, 'summary.pdf'));
  expect(carriesPhrase(text, PDF_PHRASE), `summary.pdf dropped glyphs: ${broke}`).toBe(true);

  // The audio step logs its temp path, so the folder name is Hebrew the backend wrote to launch.log.
  const log = readLaunchLog();
  const notUtf8 = "the frozen services did not write UTF-8 (services.spec's `X utf8=1`)";
  expect(log.includes(folder), `${notUtf8}, so Hebrew is lost from launch.log`).toBe(true);
  expect(log.includes('\\u05'), `${notUtf8}, so Hebrew is escaped in launch.log`).toBe(false);
  await stop();
});

test('12. the browser chain, both ends', async () => {
  await stop();
  try {
    await test.step('with Chrome gone the prerequisite resolves Edge', async () => {
      await removeBrowser('chrome');
      const { page } = await start();
      await page.goto('app://bundle/settings');
      const prereq = page.getByTestId('browser-prereq');
      await expect(prereq).toHaveAttribute('data-status', 'available', { timeout: 90_000 });
      await expect(prereq).toHaveAttribute('data-channel', 'msedge');
      await stop();
    });

    await test.step('with both gone settings shows the missing state and a PDF still renders', async () => {
      await removeBrowser('msedge');
      const { page } = await start();
      await page.goto('app://bundle/settings');
      await expect(page.getByTestId('browser-prereq')).toHaveAttribute('data-status', 'missing', {
        timeout: 90_000,
      });
      await expect(page.getByTestId('browser-prereq-install-link')).toBeVisible();

      const { db, api } = services;
      await db.createLecture(COURSE, SECOND_LECTURE);
      await db.putSummary(COURSE, SECOND_LECTURE, fixture('summary.md').toString('utf8'));
      expect(await api.runStep(COURSE, SECOND_LECTURE, 'pdf'), 'the PDF step failed').toBeNull();
      expect(await db.exists(COURSE, SECOND_LECTURE, 'summary.pdf')).toBe(true);
      await stop();
    });
  } finally {
    restoreBrowsers();
  }
});

test('13. an in-place update', async () => {
  const candidate = paths.candidate();
  const previous = paths.previous();
  await stop();

  await test.step('uninstall, and wipe the state root and userData', async () => {
    await runToExit(paths.uninstallerExe(), ['/S'], { timeoutMs: INSTALL_TIMEOUT_MS });
    // The NSIS uninstaller re-launches itself from a temp copy that deletes FastStudy.exe first and the registry keys last.
    await waitFor(
      async () => !fs.existsSync(paths.installDir()) && (await processesNamed(['Au_*', 'Un_*'])).length === 0,
      {
        timeoutMs: INSTALL_TIMEOUT_MS,
        message: `${paths.installDir()} or its uninstaller was still there 5 minutes after the silent uninstall`,
      },
    );
    for (const dir of [paths.stateRoot(), paths.userData()]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test.step(`install ${previous.version}, complete first run, seed the yt-dlp copy`, async () => {
    const { code, output } = await runToExit(previous.installer, ['/S'], {
      timeoutMs: INSTALL_TIMEOUT_MS,
      onTimeout: `${failed(ASSUMPTION.nsis)}: ${previous.installer} /S was still running after 5 minutes`,
    });
    expect(code, `the installer exited ${code}: ${output}`).toBe(0);
    await start();
    expect(readLaunchLog().split('\n')[0]).toContain(`FastStudy ${previous.version} `);
    await completeInitWall(session.page, paths.dataRoot('data-update'));
    await waitFor(() => fs.existsSync(paths.ytdlpCopy()), {
      timeoutMs: 60_000,
      message: `the server never seeded ${paths.ytdlpCopy()}`,
    });
    await stop();
  });
  const seeded = fingerprint(paths.ytdlpCopy());

  const feed = await serveUpdateFeed(candidate.dir);
  try {
    await test.step(`${previous.version} downloads ${candidate.version} from a loopback feed`, async () => {
      fs.writeFileSync(path.join(paths.resourcesDir(), MARKER), 'left by the previous install\n');
      pointUpdaterAt(paths.appUpdateYml(), feed.url);
      await start();
      const downloaded = `[updater] version ${candidate.version} downloaded`;
      await waitFor(
        () => {
          const log = readLaunchLog();
          // electron-updater logs its differential attempt failing as an error before the full
          // download it falls back to; that one is expected, since the feed has no old blockmap.
          const failure = log
            .split('\n')
            .find(
              (line) =>
                /\[updater\] (error: |check failed: )/.test(line) &&
                !line.includes('Cannot download differentially'),
            );
          if (failure) throw new Error(`${failed(ASSUMPTION.updater)}: ${failure}`);
          return log.includes(downloaded);
        },
        {
          timeoutMs: 10 * 60_000,
          intervalMs: 2000,
          message: () => `no "${downloaded}" in launch.log; the feed saw: ${feed.requests.join(', ')}`,
        },
      );
      await stop();
    });

    await test.step('the silent NSIS install runs on quit and exits', async () => {
      const installers = ['FastStudy-Setup*', 'Un_*', 'Au_*'];
      // The outcome, not a live installer: the install overlaps the app's own shutdown and is
      // normally gone before the first poll, so a snapshot is evidence a failure carries, not the check.
      let installerSeen = false;
      try {
        await waitFor(
          async () => {
            if ((await processesNamed(installers)).length) installerSeen = true;
            const reported = await productVersion(paths.appExe()).catch(() => null);
            return reported !== null && semverOf(reported) === semverOf(candidate.version);
          },
          {
            timeoutMs: 10 * 60_000,
            intervalMs: 2000,
            message: `${failed(ASSUMPTION.updater)}: ${paths.appExe()} is still not ${candidate.version} 10 minutes after the app quit`,
          },
        );
      } catch (error) {
        throw new Error(
          `${error.message}\n${await installForensics(installerSeen, candidate.version)}`,
        );
      }
      // A quit-time install must not start the app; one that did would hold the single-instance lock.
      const running = await strayAfter([paths.installDir()], 30_000);
      expect(running, 'something runs out of the install dir after the silent install').toEqual([]);
      expect(
        fs.existsSync(path.join(paths.resourcesDir(), MARKER)),
        `${failed(ASSUMPTION.wholesale)}: a file the previous install left in resources/ survived`,
      ).toBe(false);
    });
  } finally {
    await feed.close();
  }

  await test.step(`${candidate.version} launches with its keys and yt-dlp copy intact`, async () => {
    const { page } = await start();
    expect(readLaunchLog().split('\n')[0], 'launch.log names the wrong version').toContain(
      `FastStudy ${candidate.version} `,
    );
    // Settings is a route like any other, and only the wall carries the data-root confirmation.
    await page.goto('app://bundle/settings');
    await expect(page.getByTestId('data-root-input')).toBeVisible();
    await expect(page.getByTestId('data-root-confirm')).toHaveCount(0);
    await expect(page.getByTestId('init-wall')).toHaveCount(0);

    // The wall reads only whether a key is stored; a network failure, rather than "not set in the
    // environment", is what proves the key decrypted into the backend's environment.
    const { db } = services;
    await db.configured();
    await db.createCourse(UPDATE_COURSE);
    await db.createLecture(UPDATE_COURSE, LECTURE);
    await db.putFile(UPDATE_COURSE, LECTURE, 'transcript.txt', fixture('transcript.txt'));
    await openLecture(page, UPDATE_COURSE, LECTURE);
    await expectNetworkFailure(page, UPDATE_COURSE, LECTURE, 'summarize');

    expect(fingerprint(paths.ytdlpCopy()), 'the update touched the yt-dlp copy').toEqual(seeded);
    await stop();
  });
});
