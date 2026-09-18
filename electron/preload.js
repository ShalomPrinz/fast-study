const { contextBridge, ipcRenderer } = require('electron');

// Synchronous: the frontend reads URLs and secret at module scope. IPC, not `additionalArguments`,
// keeps the secret off the command line — see docs/RENDERER.md.
const config = ipcRenderer.sendSync('faststudy:config');

contextBridge.exposeInMainWorld('faststudy', {
  urls: config.urls,
  secret: config.secret,
  // Machine facts probed once at boot; the settings screens degrade on them.
  checks: config.checks,
  // The installed version and the OS language: what an error report is stamped with, and the
  // frontend's initial locale when nothing is stored.
  version: config.version,
  locale: config.locale,
  // The renderer's `SettingsBacking`: main owns the store, so a stored API key never crosses here —
  // `read()` reports the two keys as set/unset flags only.
  settings: {
    read: () => ipcRenderer.invoke('faststudy:settings-read'),
    write: (patch) => ipcRenderer.invoke('faststudy:settings-write', patch),
  },
  // Identifiers, never a path, for a file; http(s) only for a link.
  open: {
    file: (target) => ipcRenderer.invoke('faststudy:open-file', target),
    external: (url) => ipcRenderer.invoke('faststudy:open-external', url),
  },
  // Fields, never a URL: main composes the `mailto:`, so no renderer scheme reaches openExternal.
  report: {
    mail: (fields) => ipcRenderer.invoke('faststudy:report-mail', fields),
  },
  // The launch screen only: a snapshot first, since main's first push can beat the listener.
  boot: {
    snapshot: () => ipcRenderer.invoke('faststudy:boot-state'),
    subscribe: (callback) => ipcRenderer.on('faststudy:boot', (_event, state) => callback(state)),
    retry: () => ipcRenderer.send('faststudy:boot-retry'),
    quit: () => ipcRenderer.send('faststudy:boot-quit'),
  },
});
