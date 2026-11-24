// Imported first by app.js, before Sentry can spawn anything: every child inherits the env, and none needs the key.
let held = process.env.FASTSTUDY_TOKEN_KEY;
delete process.env.FASTSTUDY_TOKEN_KEY;

/** The held base64 key, undefined when unset. */
export const heldTokenKey = () => held;

/** Tests set (or clear, with undefined) the held key; the env is never read again. */
export function setTokenKey(raw) {
  held = raw;
}
