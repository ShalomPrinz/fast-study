/**
 * Thrown when an expandable item isn't a supported source.
 */
export class UnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

/**
 * Thrown when a passcode gate can't be cleared: `reason:'missing'` or `reason:'incorrect'`.
 */
export class PasscodeError extends Error {
  constructor(reason, { course, name } = {}) {
    super(`passcode ${reason}`);
    this.name = 'PasscodeError';
    this.reason = reason; // 'missing' | 'incorrect'
    this.course = course;
    this.lecture = name; // the recording name; `name` is taken by Error for the class name
  }
}
