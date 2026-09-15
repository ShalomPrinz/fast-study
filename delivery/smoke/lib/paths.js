import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every path here is owned by someone else and only read: the install dir by electron-builder's
// per-user NSIS target, the state root and userData by electron/main.js, the yt-dlp copy by
// downloader/server. DATA_ROOT's layout is deliberately absent — the suite reaches it through
// database/'s routes only.

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; the smoke suite runs only on the Windows runner`);
  return value;
}

export const PRODUCT = 'FastStudy';

export const installDir = () => path.join(env('LOCALAPPDATA'), 'Programs', PRODUCT);
export const appExe = () => path.join(installDir(), `${PRODUCT}.exe`);
export const uninstallerExe = () => path.join(installDir(), `Uninstall ${PRODUCT}.exe`);
export const resourcesDir = () => path.join(installDir(), 'resources');
export const binDir = () => path.join(resourcesDir(), 'bin');
export const servicesExe = () => path.join(resourcesDir(), 'services', 'services.exe');
export const formatsDir = () => path.join(resourcesDir(), 'latex', 'formats');
export const appUpdateYml = () => path.join(resourcesDir(), 'app-update.yml');

export const stateRoot = () => path.join(env('LOCALAPPDATA'), PRODUCT);
export const launchLog = () => path.join(stateRoot(), 'logs', 'launch.log');
export const ytdlpCopy = () => path.join(stateRoot(), 'bin', 'yt-dlp.exe');
export const userData = () => path.join(env('APPDATA'), PRODUCT);
export const settingsFile = () => path.join(userData(), 'settings.json');

/** Scratch space outside every tree the app owns: generated media, the data roots, probe scripts. */
export const workDir = () => path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'faststudy-smoke');
export const dataRoot = (name) => path.join(workDir(), name);

/** Where launch logs and traces land; the workflow uploads the whole directory on failure. */
export const resultsDir = () => path.resolve('test-results');

/** The installer the build job produced, and the version its `latest.yml` names. */
export function candidate() {
  const dir = env('SMOKE_CANDIDATE_DIR');
  const latest = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
  const version = /^version:\s*(\S+)\s*$/m.exec(latest)?.[1];
  if (!version) throw new Error(`no version line in ${path.join(dir, 'latest.yml')}`);
  const installer = path.join(dir, `${PRODUCT}-Setup-${version}.exe`);
  return { dir, version, installer };
}

/** The lower-version build of the same staged tree, which exists only for the update check. */
export function previous() {
  const dir = env('SMOKE_PREVIOUS_DIR');
  const pattern = new RegExp(`^${PRODUCT}-Setup-(.+)\\.exe$`);
  const matches = fs.readdirSync(dir).filter((name) => pattern.test(name));
  if (matches.length !== 1) throw new Error(`expected one installer in ${dir}, found ${matches}`);
  return { dir, version: pattern.exec(matches[0])[1], installer: path.join(dir, matches[0]) };
}
