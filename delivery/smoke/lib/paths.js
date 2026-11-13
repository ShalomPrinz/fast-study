import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every path here is owned by someone else and only read: the install dir by electron-builder's
// per-user NSIS target, the state root and userData by electron/main.js, the yt-dlp copy by
// downloader/server. DATA_ROOT's layout is deliberately absent — the suite reaches it through
// database/'s routes only.

function env(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set; the smoke suite runs only on its release runner`);
  return value;
}

export const PRODUCT = 'FastStudy';
// electron/package.json's artifactName: version-less, so releases/latest/download/ links it stably.
const INSTALLER = `${PRODUCT}-Setup.exe`;

const MAC = process.platform === 'darwin';
// The macOS suite installs the dmg's bundle where a user drags it; everything else there hangs off it.
export const macBundle = () => path.join('/Applications', `${PRODUCT}.app`);

// A one-click NSIS install names its directory after package.json's `name`; the files inside keep `productName`.
export const installDir = () =>
  MAC ? macBundle() : path.join(env('LOCALAPPDATA'), 'Programs', PRODUCT.toLowerCase());
export const appExe = () =>
  MAC
    ? path.join(macBundle(), 'Contents', 'MacOS', PRODUCT)
    : path.join(installDir(), `${PRODUCT}.exe`);
export const uninstallerExe = () => path.join(installDir(), `Uninstall ${PRODUCT}.exe`);
export const resourcesDir = () =>
  MAC ? path.join(macBundle(), 'Contents', 'Resources') : path.join(installDir(), 'resources');
export const binDir = () => path.join(resourcesDir(), 'bin');
export const servicesExe = () => path.join(resourcesDir(), 'services', 'faststudy-services.exe');
export const formatsDir = () => path.join(resourcesDir(), 'latex', 'formats');
export const nativeHost = () => path.join(resourcesDir(), 'bridge', 'host.js');
export const appUpdateYml = () => path.join(resourcesDir(), 'app-update.yml');

/** Where electron-updater parks a downloaded installer until the app quits, named after the feed
 *  URL's file name; the cache is named after electron/package.json's `name`, not its `productName`. */
export const pendingInstaller = () =>
  path.join(env('LOCALAPPDATA'), `${PRODUCT.toLowerCase()}-updater`, 'pending', INSTALLER);

// On macOS the state root is userData itself — electron/main.js's STATE_DIR.
export const stateRoot = () =>
  MAC
    ? path.join(os.homedir(), 'Library', 'Application Support', PRODUCT)
    : path.join(env('LOCALAPPDATA'), PRODUCT);
export const launchLog = () => path.join(stateRoot(), 'logs', 'launch.log');
export const updateLog = () => path.join(stateRoot(), 'logs', 'update.log');
export const bridgeFile = () => path.join(stateRoot(), 'bridge.json');
export const ytdlpCopy = () => path.join(stateRoot(), 'bin', 'yt-dlp.exe');
export const userData = () => (MAC ? stateRoot() : path.join(env('APPDATA'), PRODUCT));
export const settingsFile = () => path.join(userData(), 'settings.json');

/** Scratch space outside every tree the app owns: generated media, the data roots, probe scripts. */
export const workDir = () => path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'faststudy-smoke');
export const dataRoot = (name) => path.join(workDir(), name);

/** Where launch logs and traces land; on failure the workflow uploads `traces/` as `smoke-traces`
 *  and everything else as `smoke-logs`, so fetching the text does not drag the traces along. */
export const resultsDir = () => path.resolve('test-results');

/** An installer dir as build.yml uploads it: the installer and the `latest.yml` naming its version. */
function installerIn(dir) {
  const yml = path.join(dir, 'latest.yml');
  const version = /^version:\s*(\S+)\s*$/m.exec(fs.readFileSync(yml, 'utf8'))?.[1];
  if (!version) throw new Error(`no version line in ${yml}`);
  return { dir, version, installer: path.join(dir, INSTALLER) };
}

/** The installer the build job produced. */
export const candidate = () => installerIn(env('SMOKE_CANDIDATE_DIR'));

/** The lower-version build of the same staged tree, which exists only for the update check. */
export const previous = () => installerIn(env('SMOKE_PREVIOUS_DIR'));

/** A macOS build dir as build.yml uploads it: the updater's zip, `latest-mac.yml` naming its
 *  version, and for the candidate the dmg a user downloads. */
function macBuildIn(dir) {
  const yml = path.join(dir, 'latest-mac.yml');
  const version = /^version:\s*(\S+)\s*$/m.exec(fs.readFileSync(yml, 'utf8'))?.[1];
  if (!version) throw new Error(`no version line in ${yml}`);
  const name = `${PRODUCT}-mac-arm64`;
  return { dir, version, dmg: path.join(dir, `${name}.dmg`), zip: path.join(dir, `${name}.zip`) };
}

export const macCandidate = () => macBuildIn(env('SMOKE_CANDIDATE_DIR'));
export const macPrevious = () => macBuildIn(env('SMOKE_PREVIOUS_DIR'));
