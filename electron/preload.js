const { contextBridge, ipcRenderer } = require('electron');

// Synchronous on purpose: the frontend resolves the service URLs and the launch secret at module
// scope, so the bridge has to be complete before the bundle evaluates. The launch screen loads
// through this same preload and reads none of it — its `urls` are empty, nothing has a port yet. Sent over IPC rather than
// through `additionalArguments`, which would put the launch secret on a command line every other
// process on the machine can read.
const config = ipcRenderer.sendSync('faststudy:config');

contextBridge.exposeInMainWorld('faststudy', {
  urls: config.urls,
  secret: config.secret,
  // What this machine can and cannot do, probed once at boot. The settings screens degrade on it —
  // an unavailable key store disables the API-key fields instead of failing the save.
  checks: config.checks,
  // The renderer's `SettingsBacking`: main owns the store, so a stored API key never crosses here —
  // `read()` reports the two keys as set/unset flags only.
  settings: {
    read: () => ipcRenderer.invoke('faststudy:settings-read'),
    write: (patch) => ipcRenderer.invoke('faststudy:settings-write', patch),
  },
  // Opening a DATA_ROOT file sends identifiers, never a path: `database/` resolves the layout and
  // the OS opens the file in the user's own app. `openExternal` is http(s) links only.
  open: {
    file: (target) => ipcRenderer.invoke('faststudy:open-file', target),
    external: (url) => ipcRenderer.invoke('faststudy:open-external', url),
  },
  // The launch screen only. It loads before any service exists, so it takes a snapshot first and
  // then follows the pushes — main's first event can land before this page has a listener.
  boot: {
    snapshot: () => ipcRenderer.invoke('faststudy:boot-state'),
    subscribe: (callback) => ipcRenderer.on('faststudy:boot', (_event, state) => callback(state)),
    retry: () => ipcRenderer.send('faststudy:boot-retry'),
    quit: () => ipcRenderer.send('faststudy:boot-quit'),
  },
});
