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
