import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { enabled, options, scrub, scrubBreadcrumb, tags } from '../sentry.js';

const GROQ = 'gsk_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
const GEMINI = 'AIza' + 'SyD-abcdefghijklmnopqrstuvwxyz_0123';
const LINUX_FILE = '/home/shalom/data/מבוא למדעי המחשב/הרצאה 3/audio.mp3';
const WIN_FILE = String.raw`C:\Users\שלום\AppData\Local\FastStudy\data\אלגוריתמים\Recitations\תרגול 2\summary.md`;
const WIN_ROOT = String.raw`C:\Users\שלום\AppData\Local\FastStudy\data`;
const ENVS = [
  'DATA_ROOT',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'FASTSTUDY_SECRET',
  'FASTSTUDY_SENTRY_DSN',
  'FASTSTUDY_VERSION',
  'USERPROFILE',
];

beforeEach(() => {
  for (const name of ENVS) delete process.env[name];
  process.env.HOME = '/home/shalom';
});

// Everything the scrubber must never let through, checked over the whole serialized event.
function leaks(event) {
  const text = JSON.stringify(event);
  const found = ['shalom', 'שלום', GROQ, GEMINI, 'hunter2hunter2'].filter((s) => text.includes(s));
  if (/[\u0590-\u05ff]/.test(text)) found.push('hebrew');
  return found;
}

function fullEvent() {
  return {
    server_name: 'SHALOM-LAPTOP',
    user: { ip_address: '10.0.0.2' },
    message: `failed on ${LINUX_FILE} with key ${GROQ}`,
    exception: {
      values: [
        {
          type: 'Error',
          value: `ENOENT: no such file or directory, open '${WIN_FILE}'`,
          stacktrace: {
            frames: [
              {
                filename: '/home/shalom/fast_study/downloader/server/index.js',
                abs_path: '/home/shalom/fast_study/downloader/server/index.js',
                context_line: "  open('/home/shalom/data/קורס/x.mp3')",
                pre_context: ["const course = 'אלגוריתמים'"],
                vars: { key: GEMINI, lecture: 'הרצאה 3' },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      {
        message: 'GET /summary?secret=hunter2hunter2&c=%D7%A7%D7%95%D7%A8%D7%A1',
        data: { k: GROQ },
      },
    ],
    extra: { path: WIN_FILE, keys: [GEMINI, GROQ] },
    contexts: { os: { name: 'Windows' }, app: { cwd: String.raw`C:\Users\shalom\fast_study` } },
    request: {
      url: 'http://127.0.0.1:8001/lecture/%D7%94%D7%A8%D7%A6%D7%90%D7%94%203?secret=hunter2hunter2',
    },
  };
}

test('a full event leaks no path, Hebrew, home name or key', () => {
  assert.deepEqual(leaks(scrub(fullEvent(), {})), []);
});

test('server_name and user are removed', () => {
  const out = scrub(fullEvent(), {});
  assert.equal('server_name' in out, false);
  assert.equal('user' in out, false);
});

test('a Hebrew DATA_ROOT path becomes one placeholder, trailing prose kept', () => {
  process.env.DATA_ROOT = WIN_ROOT;
  assert.equal(
    scrub({ message: `cannot open ${WIN_FILE}: locked` }).message,
    'cannot open <data>: locked',
  );
});

test('DATA_ROOT matches forward slashes and JSON-doubled backslashes', () => {
  process.env.DATA_ROOT = WIN_ROOT;
  const out = scrub({ a: WIN_FILE.replaceAll('\\', '/'), b: WIN_FILE.replaceAll('\\', '\\\\') });
  assert.deepEqual(out, { a: '<data>', b: '<data>' });
});

test('a non-Hebrew name under DATA_ROOT goes too', () => {
  process.env.DATA_ROOT = '/home/shalom/data';
  assert.equal(
    scrub({ message: 'open /home/shalom/data/Calculus 1/lec.mp3' }).message,
    'open <data>',
  );
});

test('a Hebrew run is one placeholder; digits beside it stay', () => {
  const out = scrub({ message: 'course מבוא למדעי המחשב lecture הרצאה 3' });
  assert.equal(out.message, 'course <hebrew> lecture <hebrew> 3');
});

test('percent-encoded, \\u-escaped and presentation-form Hebrew are caught', () => {
  const out = scrub({
    a: '/x/%D7%A7%D7%95%D7%A8%D7%A1/y',
    b: String.raw`'\u05e7\u05d5\u05e8'`,
    c: '\ufb2a\ufb2b',
  });
  assert.deepEqual(out, { a: '/x/<hebrew>/y', b: "'<hebrew>'", c: '<hebrew>' });
});

test('with the home unknown, each OS profile folder keeps its prefix and loses the name', () => {
  delete process.env.HOME;
  const out = scrub({
    w: String.raw`C:\Users\Bob\AppData\x.log`,
    f: 'C:/Users/bob/x',
    l: '/home/alice/x',
    m: '/Users/carol',
    s: String.raw`C:\Users\John Smith\Desktop`,
  });
  assert.deepEqual(out, {
    w: String.raw`C:\Users\<user>\AppData\x.log`,
    f: 'C:/Users/<user>/x',
    l: '/home/<user>/x',
    m: '/Users/<user>',
    s: String.raw`C:\Users\<user>\Desktop`,
  });
});

test('a home outside the standard roots is redacted as a whole path component', () => {
  process.env.HOME = '/srv/profiles/shalom';
  const out = scrub({ a: '/srv/profiles/shalom/x', b: '/srv/profiles/shalomX' });
  assert.deepEqual(out, { a: '<home>/x', b: '/srv/profiles/shalomX' });
});

test('literal env key values are redacted whatever their shape', () => {
  process.env.GROQ_API_KEY = 'custom-groq-value-123';
  process.env.GEMINI_API_KEY = 'custom-gemini-value-456';
  process.env.FASTSTUDY_SECRET = 'launch-secret-789';
  const out = scrub({
    message: 'k=custom-groq-value-123',
    extra: { g: 'custom-gemini-value-456' },
    request: { headers: { 'X-FastStudy-Secret': 'launch-secret-789' } },
  });
  assert.deepEqual(out, {
    message: 'k=<key>',
    extra: { g: '<key>' },
    request: { headers: { 'X-FastStudy-Secret': '<key>' } },
  });
});

test('key patterns are redacted', () => {
  assert.equal(scrub({ message: `${GROQ} and ${GEMINI}` }).message, '<key> and <key>');
});

test('beforeBreadcrumb applies the same rules to message and data', () => {
  const out = scrubBreadcrumb(
    { message: `read ${LINUX_FILE}`, data: { url: `/x?secret=abcdef12&k=${GROQ}` } },
    {},
  );
  assert.deepEqual(leaks(out), []);
  assert.equal(out.data.url, '/x?secret=<key>&k=<key>');
});

test('a scrubber failure drops the event rather than sending it unscrubbed', () => {
  const hostile = {
    get message() {
      throw new Error('boom');
    },
  };
  assert.equal(scrub(hostile), null);
  assert.equal(scrubBreadcrumb(hostile), null);
});

test('a circular reference does not hang the walk', () => {
  const event = { message: 'x' };
  event.self = event;
  assert.equal(scrub(event).self, '[Circular]');
});

test('tags accept the six runtimes and name the platform', () => {
  for (const service of ['backend', 'database', 'server', 'auto', 'electron', 'frontend']) {
    const t = tags(service);
    assert.equal(t.service, service);
    assert.ok(['win32', 'linux', 'darwin'].includes(t.platform));
  }
});

test('tags reject an unknown service', () => {
  assert.throws(() => tags('downloader'), /unknown service/);
});

test('with no DSN, options carry none and enabled() is false', () => {
  const opts = options('server');
  assert.equal(opts.dsn, undefined);
  assert.equal(enabled(), false);
  assert.equal(opts.environment, 'development');
  assert.equal(opts.release, 'faststudy@unknown');
});

// Absent, not 0: a zero rate still turns tracing and trace-header propagation on.
test('options leave tracing unset', () => {
  assert.equal('tracesSampleRate' in options('frontend'), false);
});

test('packaged env yields the full production options', () => {
  process.env.FASTSTUDY_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/2';
  process.env.FASTSTUDY_VERSION = '1.4.0';
  process.env.FASTSTUDY_SECRET = 'launch-secret-789';
  assert.equal(enabled(), true);
  assert.deepEqual(options('auto'), {
    dsn: 'https://abc@o1.ingest.sentry.io/2',
    release: 'faststudy@1.4.0',
    environment: 'production',
    sampleRate: 1.0,
    sendDefaultPii: false,
    beforeSend: scrub,
    beforeBreadcrumb: scrubBreadcrumb,
    initialScope: { tags: tags('auto') },
  });
});

test('explicit dsn, version and environment win, as the renderer and electron main pass them', () => {
  process.env.FASTSTUDY_VERSION = '1.4.0';
  const opts = options('frontend', {
    dsn: 'https://x@y/1',
    version: '2.0.0',
    environment: 'staging',
  });
  assert.deepEqual(
    [opts.dsn, opts.release, opts.environment],
    ['https://x@y/1', 'faststudy@2.0.0', 'staging'],
  );
  assert.equal(enabled('https://x@y/1'), true);
});

test('options reject an unknown service', () => {
  assert.throws(() => options('nope'), /unknown service/);
});
