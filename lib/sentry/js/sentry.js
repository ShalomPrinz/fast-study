// No node: imports anywhere — the renderer bundles this through Vite, where they do not resolve.

export const SERVICES = Object.freeze([
  'backend',
  'database',
  'server',
  'auto',
  'electron',
  'frontend',
]);

// The longest an exit waits to flush queued events; pinned, not left to the SDK default, because the
// Sentry host may be down and nothing may wait on it. The launcher's kill grace assumes it.
export const SHUTDOWN_TIMEOUT_MS = 2000;

const HE = '\\u0590-\\u05ff\\ufb1d-\\ufb4f';
const PCT_HE = '%(?:D[67]|EF%A[CD])%[89AB][0-9A-F]';
// A Hebrew run, joined across the spaces and punctuation inside a name, in literal form and in the
// percent-, \u- and \x-escaped forms a URL, a JSON dump or a bytes repr carries it in.
const HEBREW = new RegExp(
  `[${HE}]+(?:[\\s\\-_'"]+[${HE}]+)*` +
    `|(?:${PCT_HE})+(?:(?:%20|\\+|[-_])+(?:${PCT_HE})+)*` +
    '|(?:\\\\u(?:05[89a-f]|fb[1-4])[0-9a-f])+' +
    '|(?:\\\\xd[67]\\\\x[89ab][0-9a-f])+',
  'giu',
);
// A profile folder under a Windows, Linux or macOS home root: the prefix stays, the name goes. A
// name with spaces counts only when a separator closes it, so trailing prose is not swallowed.
// No match starts right after a slash: a long slash run would otherwise rescan in quadratic time.
const HOME_GENERIC =
  /((?:[A-Za-z]:)?(?<![\\/])[\\/]+(?:Users|home)[\\/]+)(?:[^\\/\r\n\t'"<>|:]+?(?=[\\/])|[^\\/\s'"<>|:]+)/giu;
const API_KEYS = /gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}/g;
const SECRET_PARAM = /([?&]secret=)[^&#\s'"]+/gi;
// The rest of a path after a matched root: segments run to a quote, a colon or a line break.
const PATH_TAIL = `(?:[\\\\/]+[^\\\\/\\r\\n\\t'"<>|:]*)*`;
const KEY_ENVS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'FASTSTUDY_SECRET'];
// An absolute path's folders, in free text: a file:// URL, or a drive, UNC or POSIX root followed by
// at least one folder. Other scheme://… URLs match first and stay, so their hosts and routes survive.
// A root needs `/` or `\\`: a lone `\` after a quote or space is an escape like `'ק`, not a path.
const ABS_PATH = new RegExp(
  `(?<file>file://[^\\s'"<>]*/)` +
    `|(?<url>(?<![\\p{L}\\p{N}_+.-])[A-Za-z][\\p{L}\\p{N}_+.-]+://[^\\s'"<>]*)` +
    `|(?<dirs>(?:(?<![\\p{L}\\p{N}_])[A-Za-z]:|(?<![\\p{L}\\p{N}_.\\\\/-])(?=/|\\\\\\\\))` +
    `(?:[\\\\/]+[^\\\\/\\r\\n\\t'"<>|:]+)+[\\\\/]+)`,
  'gu',
);
// Frame fields that name our own code files: their folders are what makes a stack trace readable.
const FRAME_PATHS = new Set(['filename', 'abs_path', 'module']);

// `process` is absent in the renderer bundle, so every env read is guarded.
function env(name) {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
}

// The user's error-reports switch, process-wide: `FASTSTUDY_ERROR_REPORTS=1` at launch, then
// `setReporting`. Unset is off, so nothing leaves before the first-run answer.
let reportingOn = env('FASTSTUDY_ERROR_REPORTS') === '1';
// When reports last went on, in event-timestamp seconds: an event stamped no later was captured while
// off, and the SDK runs `beforeSend` asynchronously, so the flag alone may already read on for it.
let onSince = 0;

export function setReporting(on) {
  if (on && !reportingOn) onSince = Date.now() / 1000;
  reportingOn = Boolean(on);
}

export function reporting() {
  return reportingOn;
}

// Release health: the SDK counts errors into these before `beforeSend` and spans the off period.
const SESSION_ITEMS = new Set(['session', 'sessions']);

// Wraps an SDK transport factory so `send` drops every envelope while off, and session items always.
// It resolves `{}` as a success so an offline queue discards a stored envelope, not retries it.
export function gate(makeTransport) {
  return (transportOptions) => {
    const transport = makeTransport(transportOptions);
    return {
      ...transport,
      send: (envelope) => {
        const items = envelope[1].filter(([header]) => !SESSION_ITEMS.has(header.type));
        if (!reportingOn || !items.length) return Promise.resolve({});
        return transport.send([envelope[0], items]);
      },
    };
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A regex source for a filesystem root that matches either separator, doubled or not, any case.
function rootPattern(root) {
  const parts = root
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  if (!parts.length) return null;
  const lead = /^[\\/]/.test(root) ? '(?<![\\\\/])[\\\\/]+' : '';
  return lead + parts.join('[\\\\/]+') + '(?![\\p{L}\\p{N}_.-])';
}

function redactDirs(match, file, url) {
  if (url) return match;
  return file ? 'file://<path>/' : '<path>/';
}

// Redact keys, the secret, DATA_ROOT, path folders (unless `dirs` is false), home and Hebrew.
function scrubString(s, dirs = true) {
  for (const name of KEY_ENVS) {
    const value = env(name);
    if (value && value.length >= 8) s = s.split(value).join('<key>');
  }
  s = s.replace(API_KEYS, '<key>').replace(SECRET_PARAM, '$1<key>');
  const dataRoot = rootPattern(env('DATA_ROOT') || '');
  if (dataRoot) s = s.replace(new RegExp(dataRoot + PATH_TAIL, 'giu'), '<data>');
  if (dirs) s = s.replace(ABS_PATH, redactDirs);
  const home = rootPattern(env('HOME') || env('USERPROFILE') || '');
  if (home) s = s.replace(new RegExp(home, 'giu'), '<home>');
  return s.replace(HOME_GENERIC, '$1<user>').replace(HEBREW, '<hebrew>');
}

// Scrub every string; `frames` marks the items of a `frames` list, whose path fields keep folders.
function walk(value, seen, frames = false) {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, seen, frames));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[scrubString(k)] =
      frames && FRAME_PATHS.has(k) && typeof v === 'string'
        ? scrubString(v, false)
        : walk(v, seen, k === 'frames');
  }
  return out;
}

// `beforeSend`: null while reports are off or for an event captured while they were; else every
// string redacted, host name and user dropped.
// Drop on failure: an unscrubbed event is the leak this exists to prevent, a lost one is not.
export function scrub(event, _hint) {
  if (!reportingOn || event.timestamp <= onSince) return null;
  try {
    const out = walk(event, new WeakSet());
    delete out.server_name;
    delete out.user;
    return out;
  } catch {
    return null;
  }
}

// `beforeBreadcrumb`: the same redaction on one crumb, dropped while off (no off-period trail) or on failure.
export function scrubBreadcrumb(crumb, _hint) {
  if (!reportingOn) return null;
  try {
    return walk(crumb, new WeakSet());
  } catch {
    return null;
  }
}

// Node's own names; the renderer has no `process`, so it reads the platform off the user agent.
function platform() {
  if (typeof process !== 'undefined' && process.platform) return process.platform;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Windows/i.test(ua)) return 'win32';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'darwin';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}

// The tags every event carries; an unknown service is a wiring bug, so it throws.
export function tags(service) {
  if (!SERVICES.includes(service)) {
    throw new Error(
      `unknown service ${JSON.stringify(service)}; expected one of ${SERVICES.join(', ')}`,
    );
  }
  return { service, platform: platform() };
}

// Whether to init at all: no DSN means no SDK, and there is no fallback DSN.
export function enabled(dsn) {
  return Boolean(dsn || env('FASTSTUDY_SENTRY_DSN'));
}

// The object each SDK's init spreads. The renderer passes `dsn`/`version` explicitly (baked at
// build time); Node reads the env the launcher sets.
export function options(service, { dsn, version, environment } = {}) {
  const scope = { tags: tags(service) };
  return {
    dsn: dsn || env('FASTSTUDY_SENTRY_DSN') || undefined,
    release: `faststudy@${version || env('FASTSTUDY_VERSION') || 'unknown'}`,
    // The launcher sets SENTRY_ENVIRONMENT from app.isPackaged; the secret is set on dev launches too.
    environment: environment || env('SENTRY_ENVIRONMENT') || 'development',
    // No tracesSampleRate: even 0 turns tracing on and propagates trace headers.
    sampleRate: 1.0,
    sendDefaultPii: false,
    // Client reports count what was dropped, so they would tell Sentry about the off period later.
    sendClientReports: false,
    shutdownTimeout: SHUTDOWN_TIMEOUT_MS,
    beforeSend: scrub,
    beforeBreadcrumb: scrubBreadcrumb,
    initialScope: scope,
  };
}
