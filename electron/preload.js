const { contextBridge, ipcRenderer } = require('electron');

// Synchronous on purpose: the frontend resolves the service URLs and the launch secret at module
// scope, so the bridge has to be complete before the bundle evaluates. Sent over IPC rather than
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
});
