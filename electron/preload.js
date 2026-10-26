const { contextBridge, ipcRenderer } = require('electron');

// Synchronous: the frontend reads URLs and secret at module scope. IPC, not `additionalArguments`,
// keeps the secret off the command line — see docs/RENDERER.md.
const config = ipcRenderer.sendSync('faststudy:config');

// An action call: main answers `undefined` or `{error, code?}` and never throws, since Electron would
// prefix the message. It stays a plain reply here; `rejectOnFailure` below turns it into the rejection.
const action = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

const api = {
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
    // A refusal rejects with the plain `{ code, params, message }`, not an Error: the bridge strips an
    // Error's own properties, so a `code` set on one would never reach the page.
    write: async (patch) => {
      const result = await ipcRenderer.invoke('faststudy:settings-write', patch);
      if (typeof result?.code === 'string') throw result;
      return result;
    },
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
  // OS sleep and wake, pushed as `'suspend' | 'resume'`; no snapshot, since a page loaded after waking
  // needs none. Returns the unsubscribe.
  power: {
    subscribe: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('faststudy:power', listener);
      return () => ipcRenderer.removeListener('faststudy:power', listener);
    },
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
};

// The context bridge copies only `message` and `stack` of a thrown Error, so the rejection is built in
// the page's own world, where `code` survives. The function is serialised: it closes over nothing.
contextBridge.executeInMainWorld({
  func: (bridged) => {
    const rejectOnFailure = (call) => async (arg) => {
      const failure = await call(arg);
      if (!failure) return;
      const error = new Error(failure.error);
      if (failure.code) error.code = failure.code;
      throw error;
    };
    const open = {};
    for (const name of Object.keys(bridged.open)) open[name] = rejectOnFailure(bridged.open[name]);
    const updates = { ...bridged.updates, restart: rejectOnFailure(bridged.updates.restart) };
    Object.defineProperty(globalThis, 'faststudy', {
      value: Object.freeze({
        ...bridged,
        open: Object.freeze(open),
        updates: Object.freeze(updates),
      }),
      enumerable: true,
    });
  },
  args: [api],
});
