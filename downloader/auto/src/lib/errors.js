/**
 * A failure carrying the machine `code` and flat `params` the HTTP layer answers with, so the code
 * survives the throw up to the route that catches it (repo-root `docs/ERROR-CODES.md`).
 */
export class CodedError extends Error {
  constructor(code, params, message) {
    super(message);
    this.name = 'CodedError';
    this.code = code;
    this.params = params;
  }
}

/**
 * Thrown when an expandable item isn't a supported source.
 */
export class UnsupportedError extends CodedError {
  constructor(code, params, message) {
    super(code, params, message);
    this.name = 'UnsupportedError';
  }
}

/**
 * Thrown when a passcode gate can't be cleared: `reason:'missing'` or `reason:'incorrect'`.
 * The gate knows neither course nor lecture, so the route fills those in on the 409.
 */
export class PasscodeError extends CodedError {
  constructor(reason, { course, name } = {}) {
    super(
      'zoom_passcode_required',
      { reason, course: course ?? null, name: name ?? null },
      `passcode ${reason}`,
    );
    this.name = 'PasscodeError';
    this.reason = reason; // 'missing' | 'incorrect'
    this.course = course;
    this.lecture = name; // the recording name; `name` is taken by Error for the class name
  }
}

// The `{error, code, params}` body a thrown error answers with. Only a CodedError is ours: a Node
// system error's `code` is 'ENOENT'-style, so anything else wraps as internal_error.
export function failureOf(err) {
  const error = err?.message ?? 'Server error';
  if (err instanceof CodedError) return { error, code: err.code, params: err.params };
  return { error, code: 'internal_error', params: { detail: error } };
}

// undici's bare `TypeError: fetch failed` (the socket error rides as its `cause`) or an
// AbortSignal.timeout firing — never a caller's own abort, which is an AbortError.
function networkFailure(err) {
  return (
    (err instanceof TypeError && err.message === 'fetch failed') || err?.name === 'TimeoutError'
  );
}

// Node's fetch to an upstream host, stamping that host on a network failure so the route that
// catches it can name the site it could not reach.
export async function fetchUpstream(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (networkFailure(err)) err.host = new URL(String(url)).hostname;
    throw err;
  }
}

// A page fetch's network failure (Chrome's bare `TypeError: Failed to fetch`) in fetchUpstream's
// shape, so unreachable() maps it; `detail` is only Chrome's `ERR_*` token, or null when none came.
export function pageUnreachable(url, errorText) {
  const err = new TypeError('fetch failed');
  err.host = new URL(String(url)).hostname;
  err.detail = /\bERR_[A-Z0-9_]+\b/.exec(errorText ?? '')?.[0] ?? null;
  return err;
}

// A network failure of a fetchUpstream call or a page fetch as `site_unreachable {host, detail}`
// (→ 503), else null; `detail` is the socket error verbatim (as server/ reports it) or the ERR_ token.
export function unreachable(err) {
  if (!networkFailure(err) || typeof err.host !== 'string') return null;
  // A dual-stack refusal is an AggregateError whose own message is empty; its inner errors name it.
  const inner = (err.cause?.errors ?? [])
    .map((e) => e?.message)
    .filter(Boolean)
    .join('; ');
  const detail = 'detail' in err ? err.detail : err.cause?.message || inner || err.message;
  return new CodedError(
    'site_unreachable',
    { host: err.host, detail },
    detail ? `${err.host} could not be reached: ${detail}` : `${err.host} could not be reached`,
  );
}
