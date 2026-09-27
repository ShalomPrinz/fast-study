// No node: imports anywhere — the renderer bundles this through Vite, where they do not resolve.

export const SERVICES = Object.freeze([
  'backend',
  'database',
  'server',
  'auto',
  'electron',
  'frontend',
]);

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
const HOME_GENERIC =
  /((?:[A-Za-z]:)?[\\/]+(?:Users|home)[\\/]+)(?:[^\\/\r\n\t'"<>|:]+?(?=[\\/])|[^\\/\s'"<>|:]+)/giu;
const API_KEYS = /gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}/g;
const SECRET_PARAM = /([?&]secret=)[^&#\s'"]+/gi;
// The rest of a path after a matched root: segments run to a quote, a colon or a line break.
const PATH_TAIL = `(?:[\\\\/]+[^\\\\/\\r\\n\\t'"<>|:]*)*`;
const KEY_ENVS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'FASTSTUDY_SECRET'];

// `process` is absent in the renderer bundle, so every env read is guarded.
function env(name) {
  return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
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
  const lead = /^[\\/]/.test(root) ? '[\\\\/]+' : '';
  return lead + parts.join('[\\\\/]+') + '(?![\\p{L}\\p{N}_.-])';
}

// Redact keys, the launch secret, DATA_ROOT paths, home folders and Hebrew runs from one string.
function scrubString(s) {
  for (const name of KEY_ENVS) {
    const value = env(name);
    if (value && value.length >= 8) s = s.split(value).join('<key>');
  }
  s = s.replace(API_KEYS, '<key>').replace(SECRET_PARAM, '$1<key>');
  const dataRoot = rootPattern(env('DATA_ROOT') || '');
  if (dataRoot) s = s.replace(new RegExp(dataRoot + PATH_TAIL, 'giu'), '<data>');
  const home = rootPattern(env('HOME') || env('USERPROFILE') || '');
  if (home) s = s.replace(new RegExp(home, 'giu'), '<home>');
  return s.replace(HOME_GENERIC, '$1<user>').replace(HEBREW, '<hebrew>');
}

function walk(value, seen) {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[scrubString(k)] = walk(v, seen);
  return out;
}

// `beforeSend`: every string in the event redacted, and the host name and user dropped.
// Drop on failure: an unscrubbed event is the leak this exists to prevent, a lost one is not.
export function scrub(event, _hint) {
  try {
    const out = walk(event, new WeakSet());
    delete out.server_name;
    delete out.user;
    return out;
  } catch {
    return null;
  }
}

// `beforeBreadcrumb`: the same redaction applied to one breadcrumb, dropped on failure.
export function scrubBreadcrumb(crumb, _hint) {
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
    environment: environment ?? (env('FASTSTUDY_SECRET') ? 'production' : 'development'),
    // No tracesSampleRate: even 0 turns tracing on and propagates trace headers.
    sampleRate: 1.0,
    sendDefaultPii: false,
    beforeSend: scrub,
    beforeBreadcrumb: scrubBreadcrumb,
    initialScope: scope,
  };
}
