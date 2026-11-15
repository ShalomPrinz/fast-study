const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { FD_ENV, HANDOFF_FD } = require('./macHandoff');
const pending = require('./macPending');

// The install step, run by /bin/sh once main is gone: $1 pid, $2 the installed .app, $3 the staged
// .app, $4 the 0.2 s polls to wait for the pid, $5 the binary's name, $6 the app's own PATH. Stdin
// is the handoff, kept in a shell variable only (no heredoc: sh backs it with a temp file).
const HELPER = `
pid=$1
app=$2
staged=$3
polls=$4
exe=$5
apppath=$6
handoff=$(cat)
dir=$(dirname "$app")
name=$(basename "$app")
incoming="$dir/.$name.new"
previous="$dir/.$name.old"
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') [update] $*"; }
hand_over() {
  printf '%s' "$handoff" | PATH="$apppath" ${FD_ENV}=${HANDOFF_FD} "$app/Contents/MacOS/$exe" ${HANDOFF_FD}<&0 </dev/null >/dev/null 2>&1 &
  say "started $app/Contents/MacOS/$exe with the handoff on fd ${HANDOFF_FD}"
}
finish() {
  say "relaunching $app"
  if [ "$1" = 0 ] && [ -n "$handoff" ]; then
    hand_over
  else
    open "$app" || say "relaunch failed"
  fi
  exit "$1"
}
fail() {
  say "swap failed: $1"
  rm -rf "$incoming" "$staged"
  finish 1
}
say "waiting for pid $pid to exit"
tries=0
while kill -0 "$pid" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt "$polls" ]; then
    say "gave up: pid $pid is still running, nothing swapped, not relaunching"
    rm -rf "$staged"
    exit 1
  fi
  sleep 0.2
done
say "pid $pid exited"
rm -rf "$incoming" "$previous"
mv "$staged" "$incoming" || fail "could not move $staged beside $app, the installed build is untouched"
say "swapping $app"
mv "$app" "$previous" || fail "could not move $app aside, the installed build is untouched"
if ! mv "$incoming" "$app"; then
  mv "$previous" "$app" && fail "restored the previous build"
  say "swap failed: could not restore the previous build, it is left at $previous"
  rm -rf "$incoming"
  exit 1
fi
rm -rf "$previous"
say "swapped: $app is the new build"
finish 0
`;

/** The running `.app` bundle, from the binary inside it (`<bundle>/Contents/MacOS/<name>`). */
function bundlePath(execPath) {
  const bundle = path.resolve(execPath, '..', '..', '..');
  if (!bundle.endsWith('.app')) throw new Error(`not running from an .app bundle: ${execPath}`);
  return bundle;
}

/** The update's zip among the feed's resolved files (`{url, info}` each), or a throw. */
function pickZip(files) {
  const zip = files.find((file) => file.url.pathname.endsWith('.zip'));
  if (!zip) throw new Error('the update feed lists no .zip');
  if (!zip.info.sha512) throw new Error('the update feed gives the .zip no sha512');
  return zip;
}

/** Download `url` to `dest`, hashing as it streams; a body that is not `sha512` (base64, as
 *  `latest-mac.yml` spells it) is deleted and thrown on. */
async function downloadVerified({ url, sha512, dest, fetch }) {
  const response = await fetch(String(url));
  if (!response.ok || !response.body) throw new Error(`download answered ${response.status}`);
  const hash = createHash('sha512');
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(dest),
  );
  const actual = hash.digest('base64');
  if (actual === sha512) return;
  fs.rmSync(dest, { force: true });
  throw new Error(`sha512 mismatch: the feed says ${sha512}, the download is ${actual}`);
}

const ditto = (zip, target) =>
  new Promise((resolve, reject) => {
    execFile('/usr/bin/ditto', ['-x', '-k', zip, target], (error) =>
      error ? reject(error) : resolve(),
    );
  });

/** Download, verify and unpack update `version` into `dir`, replacing whatever an earlier try left
 *  there, and record it as pending for the next launch. Answers the staged `.app`. Refuses before
 *  downloading when the installed bundle cannot be swapped. */
async function stageUpdate({
  files,
  version,
  dir,
  bundle,
  // Electron's fetch, so the download follows the system proxy as the check does.
  fetch = (url) => require('electron').net.fetch(url),
  unzip = ditto,
}) {
  // Run from the dmg, or translocated by Gatekeeper, the bundle sits on a read-only mount.
  fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  const zip = pickZip(files);
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    const staged = path.join(dir, 'staged');
    fs.mkdirSync(staged, { recursive: true });
    const archive = path.join(dir, 'update.zip');
    await downloadVerified({ url: zip.url, sha512: zip.info.sha512, dest: archive, fetch });
    await unzip(archive, staged);
    fs.rmSync(archive, { force: true });
    const app = fs.readdirSync(staged).find((entry) => entry.endsWith('.app'));
    if (!app) throw new Error('the update zip holds no .app');
    const target = path.join(staged, app);
    // Written last, so a record always names a build that was verified and unpacked whole.
    const digest = await pending.treeDigest(target);
    pending.write(dir, { version, app, digest, state: 'pending' });
    return target;
  } catch (error) {
    // A failed try keeps no partial zip or half-unpacked bundle until the next check.
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Start the detached helper that waits up to `polls` × 0.2 s for `pid`, swaps `staged` over `bundle`
 *  and relaunches. Its output is `logFile`, truncated per install. Returns the helper's pid.
 *  `handoff` is text for the new build: written to the helper's stdin, which starts `exe` with it on
 *  an inherited pipe after a good swap. */
function launchHelper({
  pid,
  bundle,
  staged,
  logFile,
  handoff = null,
  exe = path.basename(process.execPath),
  polls = 300,
  // The app's own environment, so a build the helper starts directly gets what `open` would give
  // it; only the helper's tools are pinned, and the app's PATH rides as an argument.
  env = { ...process.env, PATH: '/usr/bin:/bin' },
  appPath = process.env.PATH ?? '',
}) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'w');
  try {
    const child = spawn(
      '/bin/sh',
      ['-c', HELPER, 'faststudy-update', String(pid), bundle, staged, String(polls), exe, appPath],
      // Stdin is mapped only when there is something to hand over; an unmapped fd is close-on-exec.
      { detached: true, stdio: [handoff ? 'pipe' : 'ignore', out, out], env },
    );
    // An unlistened `error` would throw in the caller long after it returned.
    child.on('error', () => {});
    if (handoff) {
      child.stdin.on('error', () => {});
      // A short write to a fresh pipe reaches the kernel inside this call, before the process exits.
      child.stdin.end(handoff);
    }
    child.unref();
    return child.pid;
  } finally {
    fs.closeSync(out);
  }
}

module.exports = { bundlePath, downloadVerified, launchHelper, pickZip, stageUpdate };
