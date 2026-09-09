const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

// Stored field → the env var the owning service reads. The field names mirror the settings wire
// format, so the file reads like the settings screen rather than like a service's environment.
const STRING_FIELDS = {
  data_root: 'DATA_ROOT',
  gemini_model: 'GEMINI_MODEL',
  gdrive_root_folder: 'GDRIVE_ROOT_FOLDER',
  auto_run: 'AUTO_RUN',
};
const BOOL_FIELDS = { drive_enabled: 'DRIVE_ENABLED' };
// Write-only: these are held as safeStorage ciphertext and reported to the renderer as set/unset.
const SECRET_FIELDS = { gemini_api_key: 'GEMINI_API_KEY', groq_api_key: 'GROQ_API_KEY' };

// The renderer's camelCase patch keys → stored fields. Anything else is refused, so a typo in a
// save is an error rather than a silently ignored setting.
const FIELDS = {
  dataRoot: 'data_root',
  geminiModel: 'gemini_model',
  gdriveRootFolder: 'gdrive_root_folder',
  autoRun: 'auto_run',
  driveEnabled: 'drive_enabled',
  geminiApiKey: 'gemini_api_key',
  groqApiKey: 'groq_api_key',
};

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A missing file is the first run; an unreadable one must not stop the app from booting.
    return {};
  }
}

function save(stored) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
}

// A stored value as the renderer's read view wants it: a non-empty string, or null for "nothing
// stored" — which has to stay distinguishable from a value, since the client owns every default.
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function encrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'secure storage is unavailable on this machine, so the API key cannot be saved',
    );
  }
  return safeStorage.encryptString(value).toString('base64');
}

function decrypt(stored) {
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64')) || null;
  } catch {
    // A key encrypted under a profile that is gone reads as absent, which the app treats as unset.
    return null;
  }
}

/** The store's read view, in the shape the renderer's `Settings` expects. */
function read() {
  const stored = load();
  return {
    dataRoot: text(stored.data_root),
    geminiApiKeySet: Boolean(text(stored.gemini_api_key)),
    groqApiKeySet: Boolean(text(stored.groq_api_key)),
    geminiModel: text(stored.gemini_model),
    driveEnabled: typeof stored.drive_enabled === 'boolean' ? stored.drive_enabled : null,
    gdriveRootFolder: text(stored.gdrive_root_folder),
    autoRun: text(stored.auto_run),
  };
}

/** Merge a partial settings object into the store and return the read view. A patch that cannot be
 *  applied in full is not applied at all: every field is converted before anything is stored, so a
 *  rejected key leaves the file untouched rather than half of the save landing. */
function write(patch) {
  const updates = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    const field = FIELDS[key];
    if (!field) throw new Error(`unknown setting: ${key}`);
    // Null means "leave it alone", so echoing back a read (all-null when unset) blanks nothing.
    if (value === null || value === undefined) continue;
    if (field in BOOL_FIELDS) {
      // A bare truth test would let the string "false" store `true`, silently flipping the setting on.
      if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
      updates[field] = value;
    } else {
      if (typeof value !== 'string') throw new Error(`${key} must be a string`);
      updates[field] = field in SECRET_FIELDS ? encrypt(value) : value.trim();
    }
  }
  save({ ...load(), ...updates });
  return read();
}

/** The settings half of every child's environment: each stored value under the env var its owning
 *  service reads. Decrypted here and passed at spawn, so no key is ever written to a command line. */
function serviceEnv() {
  const stored = load();
  const env = {};
  for (const [field, name] of Object.entries(STRING_FIELDS)) {
    const value = text(stored[field]);
    if (value) env[name] = value;
  }
  for (const [field, name] of Object.entries(BOOL_FIELDS)) {
    if (typeof stored[field] === 'boolean') env[name] = stored[field] ? 'true' : 'false';
  }
  for (const [field, name] of Object.entries(SECRET_FIELDS)) {
    const value = text(stored[field]) && decrypt(stored[field]);
    if (value) env[name] = value;
  }
  return env;
}

module.exports = { file, read, serviceEnv, write };
