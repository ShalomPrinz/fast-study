/**
 * Thrown when an expandable item turns out not to be a supported source (e.g. a
 * Moodle `url` module that redirects off-site to a non-YouTube host). Carries a
 * user-facing message; the HTTP layer maps it to 422 `{status:'unsupported'}`
 * rather than a generic 500 "try again".
 */
export class UnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedError';
  }
}
