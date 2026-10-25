const { contextBridge, ipcRenderer } = require('electron');

// Synchronous: the frontend reads URLs and secret at module scope. IPC, not `additionalArguments`,
// keeps the secret off the command line — see docs/RENDERER.md.
const config = ipcRenderer.sendSync('faststudy:config');

// An action call: main answers `undefined` or `{error}` and never throws, since Electron would prefix
// the message. Only `message` crosses the context bridge, so `'unsupported'` is matched by text.
const action = (channel) => async (arg) => {
  const failure = await ipcRenderer.invoke(channel, arg);
  if (failure) throw new Error(failure.error);
};

contextBridge.exposeInMainWorld('faststudy', {
  urls: config.urls,
  secret: config.secret,
  // Machine facts probed once at boot; the settings screens degrade on them.
  checks: config.checks,
  // The installed version and the OS language: the renderer's Sentry release, and the frontend's
  // initial locale when nothing is stored.
  version: config.version,
  locale: config.locale,
  // The init wall's prefilled data folder, `data` under the state root; never created here.
  defaultDataRoot: config.defaultDataRoot,
  // The stored error-reports switch as this page loaded; after a save, the write's result is current.
  errorReports: config.errorReports,
  // False in an unpackaged run, which never updates; the frontend's version tag reads "dev" then.
  packaged: config.packaged,
  // `process.platform`, for the frontend to offer OS-specific actions such as `open.fileWith`.
  platform: config.platform,
  // The renderer's `SettingsBacking`: main owns the store, so a stored API key never crosses here —
  // `read()` reports the two keys as set/unset flags only.
  settings: {
    read: () => ipcRenderer.invoke('faststudy:settings-read'),
    write: (patch) => ipcRenderer.invoke('faststudy:settings-write', patch),
  },
  // Identifiers, never a path, for a file; http(s) only for a link. Each resolves empty or rejects.
  open: {
    file: action('faststudy:open-file'),
    fileWith: action('faststudy:open-file-with'),
    reveal: action('faststudy:open-reveal'),
    external: action('faststudy:open-external'),
  },
  // The OS folder dialog, raising the window first; resolves to an absolute path, or `null` on cancel.
  pickFolder: (defaultPath) => ipcRenderer.invoke('faststudy:pick-folder', defaultPath),
  // The app's update row: `'downloading' | 'downloaded' | null`, pushed on every check. `restart()`
  // installs a downloaded update and relaunches, or rejects — see docs/UPDATES.md.
  updates: {
    snapshot: () => ipcRenderer.invoke('faststudy:update-state'),
    // Returns the unsubscribe, for an effect's cleanup.
    subscribe: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('faststudy:update', listener);
      return () => ipcRenderer.removeListener('faststudy:update', listener);
    },
    restart: action('faststudy:update-restart'),
  },
  // The folder Chrome loads the extension unpacked from, and `reveal()` opening it in the file manager.
  extension: {
    path: config.extensionPath,
    reveal: () => ipcRenderer.invoke('faststudy:extension-reveal'),
  },
  // The launch screen only: a snapshot first, since main's first push can beat the listener.
  boot: {
    snapshot: () => ipcRenderer.invoke('faststudy:boot-state'),
    subscribe: (callback) => ipcRenderer.on('faststudy:boot', (_event, state) => callback(state)),
    retry: () => ipcRenderer.send('faststudy:boot-retry'),
    quit: () => ipcRenderer.send('faststudy:boot-quit'),
  },
});
