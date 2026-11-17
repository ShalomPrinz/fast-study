const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Set by the swap helper on the build it starts: the inherited pipe's fd number (docs/UPDATES.md).
const FD_ENV = 'FASTSTUDY_HANDOFF_FD';
// The fd the helper maps the pipe to: the first one past stdio.
const HANDOFF_FD = 3;
// Three short secrets are a few hundred bytes; anything near this is not a handoff.
const MAX_BYTES = 64 * 1024;
// `security`'s exit status for "the specified item could not be found in the keychain".
const NOT_FOUND = 44;

/** The handoff as it travels: one JSON object, so an empty or cut-off pipe never parses as "no keys". */
function encode(secrets) {
  return JSON.stringify({ secrets });
}

/** The secrets in a received handoff, string values only; throws on anything `encode` did not write. */
function decode(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // V8's own message quotes part of the input, which here is a key.
    throw new Error('the handoff is not valid JSON');
  }
  const secrets = parsed?.secrets;
  if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
    throw new Error('the handoff carries no secrets object');
  }
  return Object.fromEntries(
    Object.entries(secrets).filter(([, value]) => typeof value === 'string' && value),
  );
}

/** Read the handoff a swap helper left on an inherited pipe, then close it, so nothing this process
 *  spawns inherits it. `null` with no handoff (every ordinary launch), else `{secrets}` or `{error}`. */
function receive(env) {
  const named = env[FD_ENV];
  if (named === undefined) return null;
  delete env[FD_ENV];
  const fd = Number(named);
  try {
    if (!Number.isInteger(fd) || fd < HANDOFF_FD) throw new Error(`${FD_ENV}=${named} is no fd`);
    // Anything but a pipe is not the helper's and is left open: closing it could close a stranger's fd.
    if (!fs.fstatSync(fd).isFIFO()) throw new Error(`fd ${fd} is not a pipe`);
  } catch (error) {
    return { error: error.message };
  }
  try {
    const chunks = [];
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    // Blocks until the helper's writer closes its end, which its own timeout bounds.
    for (let got; (got = fs.readSync(fd, buffer, 0, buffer.length - total, null)) > 0;) {
      chunks.push(Buffer.from(buffer.subarray(0, got)));
      total += got;
      if (total > MAX_BYTES) throw new Error(`the handoff is over ${MAX_BYTES} bytes`);
    }
    return { secrets: decode(Buffer.concat(chunks).toString('utf8')) };
  } catch (error) {
    return { error: error.message };
  } finally {
    fs.closeSync(fd);
  }
}

const security = (service) =>
  spawnSync('/usr/bin/security', ['delete-generic-password', '-s', service], {
    encoding: 'utf8',
    // A delete that asks the user would block the launch behind a system prompt.
    timeout: 5000,
  });

/** Delete every Keychain item named `service` — `security` removes one per call. Answers `{ok, line}`:
 *  `ok` only when none can survive (stopped at the limit or a failed call is not). The one place the
 *  previous build's Safe Storage item is dropped (docs/UPDATES.md). */
function deleteSafeStorage(service, { run = security, limit = 20 } = {}) {
  let deleted = 0;
  for (;;) {
    const { status, error, stderr } = run(service);
    if (status === 0 && ++deleted < limit) continue;
    const found = `deleted ${deleted} "${service}" Keychain item(s)`;
    if (status === 0) return { ok: false, line: `${found}, stopped at the limit` };
    if (status === NOT_FOUND) return { ok: true, line: found };
    const why =
      error?.code === 'ETIMEDOUT' ? 'timed out — a Keychain prompt is the likely cause' : null;
    const detail = why ?? error?.message ?? (String(stderr ?? '').trim() || `exit ${status}`);
    return { ok: false, line: `${found}, then the delete failed: ${detail}` };
  }
}

/** Apply a received handoff: check, delete every item named `service`, adopt only when none can survive.
 *  Never throws; answers `{step, error, lost, fields}` (docs/UPDATES.md), `fields` key names only. */
function adoptHandoff({ handoff, store, service, log, run }) {
  const { secrets, error } = handoff;
  const fields = Object.keys(secrets ?? {});
  const outcome = (step, detail, lost = false) => ({ step, error: detail, lost, fields });
  if (error) {
    log(`handoff unreadable, the stored keys are left as they were: ${error}`);
    return outcome('receive', error);
  }
  let step = 'check';
  let deleted = false;
  try {
    store.checkAdoptable();
    step = 'delete';
    const { ok, line } = deleteSafeStorage(service, { run });
    log(`handoff: ${line}`);
    if (!ok) {
      log(
        'handoff not adopted: an old Keychain item may remain, the stored keys are left as they were',
      );
      return outcome('delete', line);
    }
    deleted = true;
    step = 'adopt';
    const kept = store.adopt(secrets);
    log(`handoff: re-encrypted ${kept.join(', ') || 'nothing — no key was stored'}`);
    return outcome(null, null);
  } catch (failure) {
    log(`handoff not adopted: ${failure.message}`);
    return outcome(step, failure.message, deleted);
  }
}

module.exports = {
  FD_ENV,
  HANDOFF_FD,
  adoptHandoff,
  decode,
  deleteSafeStorage,
  encode,
  receive,
};
