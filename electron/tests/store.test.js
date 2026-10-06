const assert = require('node:assert/strict');
const fs = require('node:fs');
const { afterEach, beforeEach, test } = require('node:test');

const stub = require('./stubElectron');
const store = require('../store');

beforeEach(() => stub.useTempUserData());
afterEach(() => stub.cleanup());

const full = {
  dataRoot: '/data/root',
  geminiModel: 'gemini-2.5-pro',
  gdriveRootFolder: 'FastStudy',
  autoRun: 'audio',
  moodleSite: 'https://lemida.biu.ac.il',
  driveEnabled: true,
  errorReports: false,
  privacyConfirmed: true,
  geminiApiKey: 'gemini-secret',
  groqApiKey: 'groq-secret',
};

test('an unknown patch key is refused and nothing is written', () => {
  store.write({ dataRoot: '/data/root' });
  const before = fs.readFileSync(store.file());

  assert.throws(() => store.write({ lectureRoot: '/elsewhere' }), /unknown setting: lectureRoot/);
  assert.deepEqual(fs.readFileSync(store.file()), before);
});

test('a patch is all-or-nothing even when the valid field comes first', () => {
  assert.throws(
    () => store.write({ dataRoot: '/data/root', driveEnabled: 'false' }),
    /driveEnabled must be a boolean/,
  );
  assert.equal(fs.existsSync(store.file()), false);
  assert.equal(store.read().dataRoot, null);
});

test('an unknown autoRun mode is refused and nothing is written', () => {
  store.write({ autoRun: 'off' });
  const before = fs.readFileSync(store.file());

  assert.throws(
    () => store.write({ dataRoot: '/data/root', autoRun: 'nightly' }),
    /autoRun must be one of off, audio, full/,
  );
  assert.deepEqual(fs.readFileSync(store.file()), before);
});

test('autoRun is trimmed and lowercased before it is stored', () => {
  assert.equal(store.write({ autoRun: '  Audio ' }).autoRun, 'audio');
  assert.equal(store.serviceEnv().AUTO_RUN, 'audio');
});

test('moodleSite round-trips trimmed and reaches the child env as MOODLE_SITE', () => {
  const view = store.write({ moodleSite: '  https://x.ac.il/moodle  ' });

  assert.equal(view.moodleSite, 'https://x.ac.il/moodle');
  assert.equal(store.read().moodleSite, 'https://x.ac.il/moodle');
  assert.deepEqual(store.serviceEnv(), { MOODLE_SITE: 'https://x.ac.il/moodle' });
});

test('the string "false" cannot store true', () => {
  store.write({ driveEnabled: true });
  assert.throws(() => store.write({ driveEnabled: 'false' }), /must be a boolean/);
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
    gdriveRootFolder: written.gdriveRootFolder,
    autoRun: written.autoRun,
    moodleSite: written.moodleSite,
    errorReports: written.errorReports,
    privacyConfirmed: written.privacyConfirmed,
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
    gdriveRootFolder: null,
    autoRun: null,
    moodleSite: null,
    errorReports: null,
    privacyConfirmed: false,
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
  assert.throws(
    () => store.write({ privacyConfirmed: 'true' }),
    /privacyConfirmed must be a boolean/,
  );
  assert.equal(store.read().privacyConfirmed, false);
});

test('the string "false" cannot store errorReports', () => {
  assert.throws(() => store.write({ errorReports: 'false' }), /errorReports must be a boolean/);
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
    DRIVE_ENABLED: 'true',
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
