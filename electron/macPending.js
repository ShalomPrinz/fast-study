const fs = require('./appFs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// One record per staged update, beside it in `<state root>/update/`: `{version, app, digest, state}`,
// where `state` is how far its one launch-time install got — pending, attempted or failed (docs/UPDATES.md).
const FILE = 'pending.json';
const STATES = ['pending', 'attempted', 'failed'];

/** The record in `dir`: `null` with none, `{}` for one that does not parse — which `decide` clears. */
function read(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, FILE), 'utf8');
  } catch {
    return null;
  }
  try {
    const record = JSON.parse(text);
    return record && typeof record === 'object' ? record : {};
  } catch {
    return {};
  }
}

/** Replace the record in `dir` by rename, so a launch never reads half of one. */
function write(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILE);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(record));
  fs.renameSync(`${file}.tmp`, file);
}

function remove(dir) {
  fs.rmSync(path.join(dir, FILE), { force: true });
}

/** Drop the staged build and leave only the record that `version` is not to be tried again. */
function fail(dir, version, reason) {
  fs.rmSync(dir, { recursive: true, force: true });
  write(dir, { version, state: 'failed', reason });
}

/** Whether dotted numeric version `a` is above `b`; anything else is not newer. */
function newer(a, b) {
  const parts = (version) => String(version).split('.').map(Number);
  const [one, other] = [parts(a), parts(b)];
  if ([...one, ...other].some((part) => !Number.isInteger(part))) return false;
  for (let i = 0; i < Math.max(one.length, other.length); i++) {
    const diff = (one[i] ?? 0) - (other[i] ?? 0);
    if (diff) return diff > 0;
  }
  return false;
}

/** What a launch of build `running` does about `record`: `none` (nothing staged), `clear` (unreadable,
 *  or no newer than this build), `install`, `fail` (a swap was started and this build is still here)
 *  or `skip` (already failed once). */
function decide(record, running) {
  if (!record) return 'none';
  if (typeof record.version !== 'string' || !STATES.includes(record.state)) return 'clear';
  if (!newer(record.version, running)) return 'clear';
  return { pending: 'install', attempted: 'fail', failed: 'skip' }[record.state];
}

/** A sha256 over the tree at `root` — every entry's path, kind, mode, link target and content, in
 *  name order — so a staged build that changed on disk since it was unpacked reads differently. */
async function treeDigest(root) {
  const hash = createHash('sha256');
  const walk = async (dir, rel) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const name = `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        hash.update(`link ${name}\0${fs.readlinkSync(full)}\0`);
      } else if (entry.isDirectory()) {
        hash.update(`dir ${name}\0`);
        await walk(full, name);
      } else {
        const { mode, size } = fs.statSync(full);
        hash.update(`file ${name}\0${mode & 0o777} ${size}\0`);
        for await (const chunk of fs.createReadStream(full)) hash.update(chunk);
      }
    }
  };
  await walk(root, '');
  return hash.digest('base64');
}

module.exports = { decide, fail, newer, read, remove, treeDigest, write };
