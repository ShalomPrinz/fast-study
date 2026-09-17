const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// `protocol.js` and `store.js` destructure `electron` at require time, so the stand-in has to be in
// the module cache before either is required — and stay the same object afterwards, which is why the
// temp dir and the `safeStorage` behaviour are mutable state rather than a new fake per test.
const ELECTRON = require.resolve('electron');

const state = { userData: null };

const defaults = {
  isEncryptionAvailable: () => true,
  // A reversible stand-in for DPAPI: the tests care about the round trip and the failure path.
  encryptString: (value) => Buffer.from('enc:' + value, 'utf8'),
  decryptString: (buffer) => {
    const text = buffer.toString('utf8');
    if (!text.startsWith('enc:')) throw new Error('cannot decrypt');
    return text.slice(4);
  },
};

const safeStorage = { ...defaults };

const app = {
  isPackaged: false,
  getPath(name) {
    if (name !== 'userData') throw new Error(`unstubbed app.getPath(${name})`);
    if (!state.userData) throw new Error('useTempUserData() was not called');
    return state.userData;
  },
};

require.cache[ELECTRON] = {
  id: ELECTRON,
  filename: ELECTRON,
  loaded: true,
  exports: { app, net: {}, protocol: {}, safeStorage },
};

/** A fresh, empty `userData` for one test. */
function useTempUserData() {
  state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-store-'));
  return state.userData;
}

/** Drop the temp dir and undo whatever a test did to `safeStorage`. */
function cleanup() {
  if (state.userData) fs.rmSync(state.userData, { recursive: true, force: true });
  state.userData = null;
  Object.assign(safeStorage, defaults);
}

module.exports = { app, cleanup, safeStorage, useTempUserData };
