// The one place a shared test body reaches platform primitives: `windows.js` or `mac.js` by host,
// under the same names. A name the macOS side lacks throws, so a ported test never no-ops silently.
const impl = await (process.platform === 'darwin' ? import('./mac.js') : import('./windows.js'));

const need = (name) =>
  impl[name] ??
  (() => {
    throw new Error(`${name} is not implemented on macOS`);
  });

export const runToExit = need('runToExit');
export const offlineAppLauncher = need('offlineAppLauncher');
export const enableFirewall = need('enableFirewall');
export const blockOutbound = need('blockOutbound');
export const strayProcesses = need('strayProcesses');
export const processTable = need('processTable');
export const listeners = need('listeners');
export const processesNamed = need('processesNamed');
export const stopProcesses = need('stopProcesses');
export const productVersion = need('productVersion');
export const holdExclusive = need('holdExclusive');
export const renameAside = need('renameAside');
export const forceKill = need('forceKill');
export const evidence = need('evidence');
export const otherVolume = need('otherVolume');
export const releaseOtherVolume = need('releaseOtherVolume');
