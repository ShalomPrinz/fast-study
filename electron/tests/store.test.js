const assert = require('node:assert/strict');
const fs = require('node:fs');
const { afterEach, beforeEach, test } = require('node:test');

const stub = require('./stubElectron');
const store = require('../store');

beforeEach(() => stub.useTempUserData());
afterEach(() => stub.cleanup());

/** A refusal is returned, never thrown, in the error-code contract's shape. */
function assertRefused(result, message) {
  assert.deepEqual(Object.keys(result).sort(), ['code', 'message', 'params']);
  assert.match(result.message, message);
}

const full = {
  dataRoot: '/data/root',
  geminiModel: 'gemini-2.5-pro',
  gdriveRootFolder: 'FastStudy',
  autoRun: 'audio',
  autoRemove: 'video',
  autoRemoveAfter: 'drive',
  courseStructure: 'lectures_some',
  moodleSite: 'https://lemida.biu.ac.il',
  driveEnabled: true,
  nightlyRun: false,
  nightlyHour: 22,
  errorReports: false,
  privacyConfirmed: true,
  aiProvider: 'gemini',
  geminiApiKey: 'gemini-secret',
  groqApiKey: 'groq-secret',
};

test('an unknown patch key is refused and nothing is written', () => {
  store.write({ dataRoot: '/data/root' });
  const before = fs.readFileSync(store.file());

  assertRefused(store.write({ lectureRoot: '/elsewhere' }), /unknown setting: lectureRoot/);
  assert.deepEqual(fs.readFileSync(store.file()), before);
});

test('an unknown key and a bad value each return their code and params', () => {
  assert.deepEqual(store.write({ nightly: true }), {
    code: 'unknown_setting',
    params: { field: 'nightly' },
    message: 'unknown setting: nightly',
  });
  assert.deepEqual(store.write({ nightlyRun: 'yes' }), {
    code: 'setting_must_be_boolean',
    params: { field: 'nightlyRun' },
    message: 'nightlyRun must be a boolean',
  });
  assert.deepEqual(store.write({ nightlyHour: 3.5 }), {
    code: 'setting_must_be_integer',
    params: { field: 'nightlyHour' },
    message: 'nightlyHour must be an integer',
  });
  assert.deepEqual(store.write({ nightlyHour: 24 }), {
    code: 'setting_out_of_range',
    params: { field: 'nightlyHour', min: 0, max: 23 },
    message: 'nightlyHour must be between 0 and 23',
  });
  assert.deepEqual(store.write({ dataRoot: 5 }), {
    code: 'setting_must_be_string',
    params: { field: 'dataRoot' },
    message: 'dataRoot must be a string',
  });
  assert.deepEqual(store.write({ autoRun: ' Nightly ' }), {
    code: 'setting_invalid_choice',
    params: { field: 'autoRun', value: 'Nightly' },
    message: 'autoRun must be one of off, audio, full',
  });
  assert.equal(fs.existsSync(store.file()), false);
});

test('nightlyRun and nightlyHour round-trip and reach the backend env', () => {
  const view = store.write({ nightlyRun: true, nightlyHour: 0 });

  assert.equal(view.nightlyRun, true);
  assert.equal(view.nightlyHour, 0);
  assert.deepEqual(store.serviceEnv(), { NIGHTLY_RUN: 'true', NIGHTLY_HOUR: '0' });
  assert.equal(store.write({ nightlyHour: 23 }).nightlyHour, 23);
});

test('an out-of-range nightly_hour in the file reads as unset and stays out of the env', () => {
  fs.writeFileSync(store.file(), JSON.stringify({ nightly_hour: 30 }));
  assert.equal(store.read().nightlyHour, null);
  assert.deepEqual(store.serviceEnv(), {});
});

test('a patch is all-or-nothing even when the valid field comes first', () => {
  assertRefused(
    store.write({ dataRoot: '/data/root', driveEnabled: 'false' }),
    /driveEnabled must be a boolean/,
  );
  assert.equal(fs.existsSync(store.file()), false);
  assert.equal(store.read().dataRoot, null);
});

test('an unknown autoRun mode is refused and nothing is written', () => {
  store.write({ autoRun: 'off' });
  const before = fs.readFileSync(store.file());

  assertRefused(
    store.write({ dataRoot: '/data/root', autoRun: 'nightly' }),
    /autoRun must be one of off, audio, full/,
  );
  assert.deepEqual(fs.readFileSync(store.file()), before);
});

test('autoRun is trimmed and lowercased before it is stored', () => {
  assert.equal(store.write({ autoRun: '  Audio ' }).autoRun, 'audio');
  assert.equal(store.serviceEnv().AUTO_RUN, 'audio');
});

test('an unknown autoRemove or autoRemoveAfter is refused and nothing is written', () => {
  store.write({ autoRemove: 'off' });
  const before = fs.readFileSync(store.file());

  assertRefused(
    store.write({ dataRoot: '/data/root', autoRemove: 'pdf' }),
    /autoRemove must be one of off, video, audio/,
  );
  assertRefused(
    store.write({ dataRoot: '/data/root', autoRemoveAfter: 'never' }),
    /autoRemoveAfter must be one of pdf, drive/,
  );
  assertRefused(store.write({ autoRemove: true }), /autoRemove must be a string/);
  assert.deepEqual(fs.readFileSync(store.file()), before);
});

test('autoRemove and autoRemoveAfter are trimmed and lowercased before they are stored', () => {
  const view = store.write({ autoRemove: ' Audio ', autoRemoveAfter: 'PDF ' });

  assert.equal(view.autoRemove, 'audio');
  assert.equal(view.autoRemoveAfter, 'pdf');
  assert.deepEqual(store.serviceEnv(), { AUTO_REMOVE: 'audio', AUTO_REMOVE_AFTER: 'pdf' });
});

test('a hand-edited auto-remove value reads normalized, or unset when invalid', () => {
  fs.writeFileSync(
    store.file(),
    JSON.stringify({ auto_remove: 'everything', auto_remove_after: ' Drive ' }),
  );

  assert.equal(store.read().autoRemove, null);
  assert.equal(store.read().autoRemoveAfter, 'drive');
  assert.deepEqual(store.serviceEnv(), { AUTO_REMOVE_AFTER: 'drive' });
});

test('courseStructure is lowercased, stored, and reaches the child env as COURSE_STRUCTURE', () => {
  const view = store.write({ courseStructure: ' Lectures_All ' });

  assert.equal(view.courseStructure, 'lectures_all');
  assert.deepEqual(store.serviceEnv(), { COURSE_STRUCTURE: 'lectures_all' });
});

test('an unknown courseStructure is refused and nothing is written', () => {
  store.write({ courseStructure: 'split' });
  const before = fs.readFileSync(store.file());

  assertRefused(
    store.write({ dataRoot: '/data/root', courseStructure: 'flat' }),
    /courseStructure must be one of split, lectures_all, lectures_some/,
  );
  assert.deepEqual(fs.readFileSync(store.file()), before);
});

test('a hand-edited courseStructure outside the list reads null and stays out of the env', () => {
  fs.writeFileSync(store.file(), JSON.stringify({ course_structure: 'nested' }));

  assert.equal(store.read().courseStructure, null);
  assert.deepEqual(store.serviceEnv(), {});
});

test('moodleSite round-trips trimmed and reaches the child env as MOODLE_SITE', () => {
  const view = store.write({ moodleSite: '  https://x.ac.il/moodle  ' });

  assert.equal(view.moodleSite, 'https://x.ac.il/moodle');
  assert.equal(store.read().moodleSite, 'https://x.ac.il/moodle');
  assert.deepEqual(store.serviceEnv(), { MOODLE_SITE: 'https://x.ac.il/moodle' });
});

test('the string "false" cannot store true', () => {
  store.write({ driveEnabled: true });
  assertRefused(store.write({ driveEnabled: 'false' }), /must be a boolean/);
  assert.equal(store.read().driveEnabled, true);
});

test('null and undefined leave a stored field alone', () => {
  store.write({ dataRoot: '/data/root', geminiModel: 'gemini-2.5-pro' });
  const written = store.write({ dataRoot: null, geminiModel: undefined, autoRun: 'audio' });

  assert.equal(written.dataRoot, '/data/root');
  assert.equal(written.geminiModel, 'gemini-2.5-pro');
  assert.equal(written.autoRun, 'audio');
});

test('echoing a read back blanks nothing', () => {
  const written = store.write({ dataRoot: '/data/root' });
  // The read view minus its two write-only flags is exactly what the renderer sends back.
  const echo = {
    dataRoot: written.dataRoot,
    geminiModel: written.geminiModel,
    driveEnabled: written.driveEnabled,
    nightlyRun: written.nightlyRun,
    nightlyHour: written.nightlyHour,
    gdriveRootFolder: written.gdriveRootFolder,
    autoRun: written.autoRun,
    autoRemove: written.autoRemove,
    autoRemoveAfter: written.autoRemoveAfter,
    courseStructure: written.courseStructure,
    moodleSite: written.moodleSite,
    errorReports: written.errorReports,
    privacyConfirmed: written.privacyConfirmed,
    aiProvider: written.aiProvider,
  };

  assert.deepEqual(store.write(echo), written);
});

test('a secret is stored encrypted and read back only as a flag', () => {
  const view = store.write({ geminiApiKey: 'gemini-secret' });

  assert.equal(fs.readFileSync(store.file(), 'utf8').includes('gemini-secret'), false);
  assert.equal(view.geminiApiKeySet, true);
  assert.equal(view.groqApiKeySet, false);
  assert.equal('geminiApiKey' in view, false);
});

test('the read view trims, and a blank string reads as unset', () => {
  const view = store.write({ dataRoot: '  /data/root  ', geminiModel: '   ' });

  assert.equal(view.dataRoot, '/data/root');
  assert.equal(view.geminiModel, null);
});

test('an unset store reads as all-null, bar privacyConfirmed, which reads false', () => {
  assert.deepEqual(store.read(), {
    dataRoot: null,
    geminiApiKeySet: false,
    groqApiKeySet: false,
    geminiModel: null,
    driveEnabled: null,
    nightlyRun: null,
    nightlyHour: null,
    gdriveRootFolder: null,
    autoRun: null,
    autoRemove: null,
    autoRemoveAfter: null,
    courseStructure: null,
    moodleSite: null,
    errorReports: null,
    privacyConfirmed: false,
    aiProvider: null,
  });
});

test('errorReports round-trips as a boolean and never reaches a child env', () => {
  assert.equal(store.write({ errorReports: false }).errorReports, false);
  assert.equal(store.read().errorReports, false);
  assert.deepEqual(store.serviceEnv(), {});
  assert.equal(store.write({ errorReports: true }).errorReports, true);
});

test('privacyConfirmed round-trips as a boolean and never reaches a child env', () => {
  assert.equal(store.write({ privacyConfirmed: true }).privacyConfirmed, true);
  assert.equal(store.read().privacyConfirmed, true);
  assert.deepEqual(store.serviceEnv(), {});
  assert.equal(store.write({ privacyConfirmed: false }).privacyConfirmed, false);
  assertRefused(store.write({ privacyConfirmed: 'true' }), /privacyConfirmed must be a boolean/);
  assert.equal(store.read().privacyConfirmed, false);
});

test('aiProvider round-trips one of three providers and never reaches a child env', () => {
  assert.equal(store.write({ aiProvider: ' ChatGPT ' }).aiProvider, 'chatgpt');
  assert.equal(store.read().aiProvider, 'chatgpt');
  assert.deepEqual(store.serviceEnv(), {});
  assertRefused(
    store.write({ aiProvider: 'copilot' }),
    /aiProvider must be one of claude, chatgpt, gemini/,
  );
  assertRefused(store.write({ aiProvider: true }), /aiProvider must be a string/);
  assert.equal(store.read().aiProvider, 'chatgpt');
});

test('an unknown aiProvider in the file reads as unset', () => {
  fs.writeFileSync(store.file(), JSON.stringify({ ai_provider: 'copilot' }));
  assert.equal(store.read().aiProvider, null);
});

test('the string "false" cannot store errorReports', () => {
  assertRefused(store.write({ errorReports: 'false' }), /errorReports must be a boolean/);
  assert.equal(fs.existsSync(store.file()), false);
});

test('serviceEnv maps every field onto its service env var', () => {
  store.write(full);

  assert.deepEqual(store.serviceEnv(), {
    DATA_ROOT: '/data/root',
    GEMINI_MODEL: 'gemini-2.5-pro',
    GDRIVE_ROOT_FOLDER: 'FastStudy',
    AUTO_RUN: 'audio',
    MOODLE_SITE: 'https://lemida.biu.ac.il',
    AUTO_REMOVE: 'video',
    AUTO_REMOVE_AFTER: 'drive',
    COURSE_STRUCTURE: 'lectures_some',
    DRIVE_ENABLED: 'true',
    NIGHTLY_RUN: 'false',
    NIGHTLY_HOUR: '22',
    GEMINI_API_KEY: 'gemini-secret',
    GROQ_API_KEY: 'groq-secret',
  });
});

test('serviceEnv spells a false boolean as the string "false"', () => {
  store.write({ driveEnabled: false });
  assert.deepEqual(store.serviceEnv(), { DRIVE_ENABLED: 'false' });
});

test('serviceEnv omits every unset field', () => {
  assert.deepEqual(store.serviceEnv(), {});
});

test('a secret that cannot be decrypted is absent from the environment', () => {
  store.write(full);
  stub.safeStorage.decryptString = () => {
    throw new Error('no key for this profile');
  };

  const env = store.serviceEnv();
  assert.equal('GEMINI_API_KEY' in env, false);
  assert.equal('GROQ_API_KEY' in env, false);
  assert.equal(env.DATA_ROOT, '/data/root');
});

test('a machine with no key store refuses the write', () => {
  stub.safeStorage.isEncryptionAvailable = () => false;

  assert.throws(() => store.write({ groqApiKey: 'groq-secret' }), /secure storage is unavailable/);
  assert.equal(fs.existsSync(store.file()), false);
});

test('the token key is generated once, 32 bytes of base64, and reused', () => {
  const first = store.tokenKey();
  assert.equal(Buffer.from(first.key, 'base64').length, 32);
  assert.equal(first.regenerated, false);
  assert.deepEqual(store.tokenKey(), first);
});

test('the token key is stored encrypted, survives a settings write and never reaches read()', () => {
  const { key } = store.tokenKey();
  store.write({ dataRoot: '/data/root' });
  assert.equal(fs.readFileSync(store.file(), 'utf8').includes(key), false);
  assert.equal(store.tokenKey().key, key);
  assert.equal(JSON.stringify(store.read()).includes(key), false);
});

test('an undecryptable token key is regenerated', () => {
  const { key } = store.tokenKey();
  const stored = JSON.parse(fs.readFileSync(store.file(), 'utf8'));
  stored.token_key = Buffer.from('garbage').toString('base64');
  fs.writeFileSync(store.file(), JSON.stringify(stored));

  const next = store.tokenKey();
  assert.notEqual(next.key, key);
  assert.equal(next.regenerated, true);
  assert.deepEqual(store.tokenKey(), { key: next.key, regenerated: false });
});

test('with no key store there is no token key and nothing is written', () => {
  stub.safeStorage.isEncryptionAvailable = () => false;
  assert.deepEqual(store.tokenKey(), { key: null, regenerated: false });
  assert.equal(fs.existsSync(store.file()), false);
});

test('the token key is not a settings env var', () => {
  store.tokenKey();
  assert.equal('FASTSTUDY_TOKEN_KEY' in store.serviceEnv(), false);
});
