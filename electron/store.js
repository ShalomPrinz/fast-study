const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { app, safeStorage } = require('electron');

// Stored field → the env var the owning service reads. The field names mirror the settings wire
// format, so the file reads like the settings screen rather than like a service's environment.
const STRING_FIELDS = {
  data_root: 'DATA_ROOT',
  gemini_model: 'GEMINI_MODEL',
  gdrive_root_folder: 'GDRIVE_ROOT_FOLDER',
  auto_run: 'AUTO_RUN',
  moodle_site: 'MOODLE_SITE',
  auto_remove: 'AUTO_REMOVE',
  auto_remove_after: 'AUTO_REMOVE_AFTER',
  course_structure: 'COURSE_STRUCTURE',
};
// Fields whose write is refused outside a fixed list. auto_run mirrors AUTO_RUN_MODES in
// backend/services/settings.py; the auto-remove pair and course_structure mirror database/settings.py.
const CHOICES = {
  auto_run: ['off', 'audio', 'full'],
  // The renderer's chosen AI chat, launcher-only like `privacy_confirmed`; unset or unknown reads null.
  ai_provider: ['claude', 'chatgpt', 'gemini'],
  auto_remove: ['off', 'video', 'audio'],
  auto_remove_after: ['pdf', 'drive'],
  course_structure: ['split', 'lectures_all', 'lectures_some'],
};
const BOOL_FIELDS = {
  drive_enabled: 'DRIVE_ENABLED',
  gemini_auto_fallback: 'GEMINI_AUTO_FALLBACK',
};
// Integers with their env var and inclusive range; none today, a value outside it reads as unset.
const INT_FIELDS = {};
// Booleans no service gets as a settings env var: `error_reports` main turns into each process's
// Sentry flag itself; `privacy_confirmed` is the renderer's record that the privacy notice was answered.
const LAUNCHER_BOOL_FIELDS = ['error_reports', 'privacy_confirmed'];
// Write-only: these are held as safeStorage ciphertext and reported to the renderer as set/unset.
const SECRET_FIELDS = { gemini_api_key: 'GEMINI_API_KEY', groq_api_key: 'GROQ_API_KEY' };

// The renderer's camelCase patch keys → stored fields. Anything else is refused, so a typo in a
// save is an error rather than a silently ignored setting.
const FIELDS = {
  dataRoot: 'data_root',
  geminiModel: 'gemini_model',
  gdriveRootFolder: 'gdrive_root_folder',
  autoRun: 'auto_run',
  autoRemove: 'auto_remove',
  autoRemoveAfter: 'auto_remove_after',
  courseStructure: 'course_structure',
  moodleSite: 'moodle_site',
  driveEnabled: 'drive_enabled',
  geminiAutoFallback: 'gemini_auto_fallback',
  errorReports: 'error_reports',
  privacyConfirmed: 'privacy_confirmed',
  aiProvider: 'ai_provider',
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

// A choice field trimmed and lowercased, or null when unset or outside its list — as database/settings.py reads it.
function choice(field, value) {
  const picked = typeof value === 'string' ? value.trim().toLowerCase() : null;
  return CHOICES[field].includes(picked) ? picked : null;
}

function bool(value) {
  return typeof value === 'boolean' ? value : null;
}

// An integer field inside its range, or null when unset or outside it.
function int(field, value) {
  const { min, max } = INT_FIELDS[field];
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// A refused patch, carrying the error-code contract's `code` and flat `params` (docs/ERROR-CODES.md).
class SettingRefused extends Error {
  constructor(message, code, params) {
    super(message);
    this.code = code;
    this.params = params;
  }
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
    driveEnabled: bool(stored.drive_enabled),
    geminiAutoFallback: bool(stored.gemini_auto_fallback),
    gdriveRootFolder: text(stored.gdrive_root_folder),
    autoRun: text(stored.auto_run),
    autoRemove: choice('auto_remove', stored.auto_remove),
    autoRemoveAfter: choice('auto_remove_after', stored.auto_remove_after),
    courseStructure: choice('course_structure', stored.course_structure),
    moodleSite: text(stored.moodle_site),
    errorReports: bool(stored.error_reports),
    // Unset reads false: nothing was confirmed until the renderer says so.
    privacyConfirmed: stored.privacy_confirmed === true,
    aiProvider: choice('ai_provider', stored.ai_provider),
  };
}

/** Merge a partial settings object into the store and return the read view, or a refusal as
 *  `{ code, params, message }` — a return value because IPC drops an Error's own properties. A patch
 *  that cannot be applied in full is not applied at all: every field is converted before anything
 *  is stored, so a rejected key leaves the file untouched rather than half of the save landing. */
function write(patch) {
  let updates;
  try {
    updates = convert(patch);
  } catch (error) {
    if (!(error instanceof SettingRefused)) throw error;
    return { code: error.code, params: error.params, message: error.message };
  }
  save({ ...load(), ...updates });
  return read();
}

// Each patch key validated into its stored field and value; throws SettingRefused on the first bad one.
// Codes and params are spelled as database/settings.py spells them for the same refusals.
function convert(patch) {
  const updates = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    const field = FIELDS[key];
    if (!field)
      throw new SettingRefused(`unknown setting: ${key}`, 'unknown_setting', { field: key });
    // Null means "leave it alone", so echoing back a read (all-null when unset) blanks nothing.
    if (value === null || value === undefined) continue;
    if (field in BOOL_FIELDS || LAUNCHER_BOOL_FIELDS.includes(field)) {
      // A bare truth test would let the string "false" store `true`, silently flipping the setting on.
      if (typeof value !== 'boolean') {
        throw new SettingRefused(`${key} must be a boolean`, 'setting_must_be_boolean', {
          field: key,
        });
      }
      updates[field] = value;
    } else if (field in INT_FIELDS) {
      if (!Number.isInteger(value)) {
        throw new SettingRefused(`${key} must be an integer`, 'setting_must_be_integer', {
          field: key,
        });
      }
      const { min, max } = INT_FIELDS[field];
      if (value < min || value > max) {
        throw new SettingRefused(
          `${key} must be between ${min} and ${max}`,
          'setting_out_of_range',
          { field: key, min, max },
        );
      }
      updates[field] = value;
    } else {
      if (typeof value !== 'string') {
        throw new SettingRefused(`${key} must be a string`, 'setting_must_be_string', {
          field: key,
        });
      }
      if (field in CHOICES) {
        const picked = value.trim().toLowerCase();
        if (!CHOICES[field].includes(picked)) {
          throw new SettingRefused(
            `${key} must be one of ${CHOICES[field].join(', ')}`,
            'setting_invalid_choice',
            { field: key, value: value.trim() },
          );
        }
        updates[field] = picked;
      } else {
        updates[field] = field in SECRET_FIELDS ? encrypt(value) : value.trim();
      }
    }
  }
  return updates;
}

/** The settings half of every child's environment: each stored value under the env var its owning
 *  service reads. Decrypted here and passed at spawn, so no key is ever written to a command line. */
function serviceEnv() {
  const stored = load();
  const env = {};
  for (const [field, name] of Object.entries(STRING_FIELDS)) {
    // auto_run passes through as stored: the backend reads an unknown mode as 'full'.
    const value =
      field in CHOICES && field !== 'auto_run' ? choice(field, stored[field]) : text(stored[field]);
    if (value) env[name] = value;
  }
  for (const [field, name] of Object.entries(BOOL_FIELDS)) {
    if (typeof stored[field] === 'boolean') env[name] = stored[field] ? 'true' : 'false';
  }
  for (const [field, { env: name }] of Object.entries(INT_FIELDS)) {
    const value = int(field, stored[field]);
    if (value !== null) env[name] = String(value);
  }
  for (const [field, name] of Object.entries(SECRET_FIELDS)) {
    const value = text(stored[field]) && decrypt(stored[field]);
    if (value) env[name] = value;
  }
  return env;
}

/** The 32-byte key `auto` encrypts its Moodle token with, as standard base64, or null with no key
 *  store. Generated once and kept as safeStorage ciphertext in `token_key`; one that no longer
 *  decrypts is replaced, which orphans the token it protected. `regenerated` flags that replacement. */
function tokenKey() {
  if (!safeStorage.isEncryptionAvailable()) return { key: null, regenerated: false };
  const stored = load();
  const existing = text(stored.token_key) && decrypt(stored.token_key);
  if (existing) return { key: existing, regenerated: false };
  const key = randomBytes(32).toString('base64');
  save({ ...stored, token_key: encrypt(key) });
  return { key, regenerated: Boolean(stored.token_key) };
}

// FIELDS and INT_FIELDS are exported so a test can inject an integer field while none is real.
module.exports = { FIELDS, INT_FIELDS, file, read, serviceEnv, tokenKey, write };
