import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SHUTDOWN_TIMEOUT_MS, enabled, options, scrub, scrubBreadcrumb, tags } from '../sentry.js';

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
  'SENTRY_ENVIRONMENT',
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
    a: 'x/%D7%A7%D7%95%D7%A8%D7%A1/y',
    b: String.raw`'\u05e7\u05d5\u05e8'`,
    c: '\ufb2a\ufb2b',
  });
  assert.deepEqual(out, { a: 'x/<hebrew>/y', b: "'<hebrew>'", c: '<hebrew>' });
});

// An event whose one exception frame names each path in turn as its abs_path.
function framePaths(...paths) {
  const frames = paths.map((p) => ({ abs_path: p, filename: p }));
  return { exception: { values: [{ stacktrace: { frames } }] } };
}

const absPaths = (event) => event.exception.values[0].stacktrace.frames.map((f) => f.abs_path);

test('in frame paths, with the home unknown, a profile folder keeps its prefix, loses the name', () => {
  delete process.env.HOME;
  const out = scrub(
    framePaths(
      String.raw`C:\Users\Bob\AppData\x.js`,
      'C:/Users/bob/x.js',
      '/home/alice/x.py',
      '/Users/carol',
      String.raw`C:\Users\John Smith\Desktop\x.js`,
    ),
  );
  assert.deepEqual(absPaths(out), [
    String.raw`C:\Users\<user>\AppData\x.js`,
    'C:/Users/<user>/x.js',
    '/home/<user>/x.py',
    '/Users/<user>',
    String.raw`C:\Users\<user>\Desktop\x.js`,
  ]);
});

test('in frame paths, a non-standard home is redacted as a whole path component', () => {
  process.env.HOME = '/srv/profiles/shalom';
  const out = scrub(framePaths('/srv/profiles/shalom/x.py', '/srv/profiles/shalomX/y.py'));
  assert.deepEqual(absPaths(out), ['<home>/x.py', '/srv/profiles/shalomX/y.py']);
});

test("our own code's frame paths keep folders; home, DATA_ROOT and Hebrew rules still apply", () => {
  process.env.DATA_ROOT = '/mnt/data';
  const out = scrub(
    framePaths(
      '/opt/FastStudy/resources/backend/pipeline.py',
      'app://bundle/assets/index-abc.js',
      '/home/shalom/fast_study/backend/קוד/x.py',
      '/mnt/data/Calculus/x.py',
    ),
  );
  assert.deepEqual(absPaths(out), [
    '/opt/FastStudy/resources/backend/pipeline.py',
    'app://bundle/assets/index-abc.js',
    '<home>/fast_study/backend/<hebrew>/x.py',
    '<data>',
  ]);
});

test("only a frame's own path fields keep folders; its vars and source lines are free text", () => {
  const frame = {
    abs_path: '/opt/app/x.py',
    context_line: "open('/mnt/data/Calculus/week 2/notes.pdf')",
    vars: { path: "'/mnt/data/Calculus/week 2/notes.pdf'", filename: '/mnt/a/b.pdf' },
  };
  const out = scrub({ exception: { values: [{ stacktrace: { frames: [frame] } }] } });
  assert.deepEqual(out.exception.values[0].stacktrace.frames[0], {
    abs_path: '/opt/app/x.py',
    context_line: "open('<path>/notes.pdf')",
    vars: { path: "'<path>/notes.pdf'", filename: '<path>/b.pdf' },
  });
});

// A runtime-changed data root is not DATA_ROOT here, so every absolute path loses its folders.
test('free-text absolute paths keep only the file name', () => {
  const cases = [
    [
      String.raw`cannot open D:\Lectures\Algebra\Lecture 3\audio.mp3: locked`,
      'cannot open <path>/audio.mp3: locked',
    ],
    [
      JSON.stringify({ path: String.raw`D:\Lectures\Algebra\Lecture 3\audio.mp3` }),
      '{"path":"<path>/audio.mp3"}',
    ],
    ["No such file: '/mnt/data/Calculus/week 2/notes.pdf'", "No such file: '<path>/notes.pdf'"],
    [String.raw`copy \\nas\share\Physics\Lab 1\notes.pdf done`, 'copy <path>/notes.pdf done'],
    [
      'load file:///C:/Lectures/Algebra/Lecture%203/audio.mp3 failed',
      'load file://<path>/audio.mp3 failed',
    ],
    [String.raw`D:\Lectures\Algebra\הרצאה 3.mp3`, '<path>/<hebrew> 3.mp3'],
    [String.raw`C:\Users\John Smith\Desktop\x.pdf`, '<path>/x.pdf'],
  ];
  for (const [text, expected] of cases) assert.equal(scrub({ message: text }).message, expected);
});

// scheme:// URLs keep host and route (Hebrew still goes); a path with no folder is left alone.
test('URLs and folderless paths are kept', () => {
  const cases = [
    [
      'GET http://127.0.0.1:1234/api/lectures/Algebra 500',
      'GET http://127.0.0.1:1234/api/lectures/Algebra 500',
    ],
    [
      'http://127.0.0.1:8001/lecture/%D7%A7%D7%95%D7%A8%D7%A1/x',
      'http://127.0.0.1:8001/lecture/<hebrew>/x',
    ],
    ['at app://bundle/assets/index-abc.js:1:9700', 'at app://bundle/assets/index-abc.js:1:9700'],
    ['GET /summary?c=x', 'GET /summary?c=x'],
  ];
  for (const [text, expected] of cases) assert.equal(scrub({ message: text }).message, expected);
});

// No root pattern rescans a slash run from every offset, so 50,000 slashes stay linear.
test('a 50,000-slash string scrubs fast', () => {
  process.env.DATA_ROOT = '/mnt/data';
  const text = '/'.repeat(50000) + 'a';
  const start = performance.now();
  const out = scrub({ message: text });
  assert.ok(performance.now() - start < 1000);
  assert.equal(out.message, text);
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

// The Sentry host may be down: an exit waits on it for a short, fixed bound and no longer.
test('options pin the shutdown flush to a short bound', () => {
  assert.equal(SHUTDOWN_TIMEOUT_MS, 2000);
  assert.equal(options('server').shutdownTimeout, SHUTDOWN_TIMEOUT_MS);
});

test('packaged env yields the full production options', () => {
  process.env.FASTSTUDY_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/2';
  process.env.FASTSTUDY_VERSION = '1.4.0';
  process.env.SENTRY_ENVIRONMENT = 'production';
  assert.equal(enabled(), true);
  assert.deepEqual(options('auto'), {
    dsn: 'https://abc@o1.ingest.sentry.io/2',
    release: 'faststudy@1.4.0',
    environment: 'production',
    sampleRate: 1.0,
    sendDefaultPii: false,
    shutdownTimeout: 2000,
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

test('environment: explicit beats SENTRY_ENVIRONMENT beats development; the secret no longer decides', () => {
  process.env.FASTSTUDY_SECRET = 'launch-secret-789';
  assert.equal(options('server').environment, 'development');
  process.env.SENTRY_ENVIRONMENT = 'production';
  assert.equal(options('server').environment, 'production');
  assert.equal(options('server', { environment: 'staging' }).environment, 'staging');
});

test('options reject an unknown service', () => {
  assert.throws(() => options('nope'), /unknown service/);
});
