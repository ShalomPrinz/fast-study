// Every Mach-O in an .app: its signature verified and its architectures read. `node macho.js <app>`
// is build.yml's signing gate; the macOS smoke suite runs the same walk on the installed bundle.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What runs natively on a Mac without Rosetta, which the runner has and a user's Mac may not.
const NATIVE = ['Contents/MacOS/', 'Contents/Resources/bin/', 'Contents/Resources/services/'];

/** Is `file` a Mach-O, thin or fat, by its magic? A Java class shares the fat magic, told apart by
 *  the count that follows it. */
function isMachO(file) {
  const head = Buffer.alloc(8);
  const fd = fs.openSync(file, 'r');
  try {
    if (fs.readSync(fd, head, 0, 8, 0) < 8) return false;
  } finally {
    fs.closeSync(fd);
  }
  const magic = head.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) return true;
  return (magic === 0xcafebabe || magic === 0xcafebabf) && head.readUInt32BE(4) < 30;
}

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile()) yield full;
  }
}

function run(file, args) {
  try {
    return { ok: true, output: execFileSync(file, args, { stdio: 'pipe' }).toString().trim() };
  } catch (error) {
    return { ok: false, output: `${error.stderr ?? ''}${error.stdout ?? ''}`.trim() };
  }
}

/** Every Mach-O under `app` (symlinks skipped) as `{ file, archs, error }`: `file` relative to the
 *  bundle, `error` naming a failed `codesign --verify --strict` or a native file with no arm64 slice. */
export function checkMachOs(app) {
  const found = [];
  for (const full of files(app)) {
    if (!isMachO(full)) continue;
    const file = path.relative(app, full);
    const archs = run('/usr/bin/lipo', ['-archs', full]).output;
    const signed = run('/usr/bin/codesign', ['--verify', '--strict', full]);
    let error = signed.ok ? null : `codesign: ${signed.output || 'failed with no output'}`;
    if (
      !error &&
      NATIVE.some((dir) => file.startsWith(dir)) &&
      !archs.split(/\s+/).includes('arm64')
    ) {
      error = `no arm64 slice (${archs || 'unreadable'})`;
    }
    found.push({ file, archs, error });
  }
  return found;
}

/** The walk as text: the count, each native tool's architectures, and every failure. */
export function describe(found) {
  const bad = found.filter((entry) => entry.error);
  const tools = found.filter((entry) => entry.file.startsWith('Contents/Resources/bin/'));
  return [
    `${found.length} Mach-O files, ${found.length - bad.length} verified, ${bad.length} failed`,
    ...tools.map((entry) => `${entry.file}: ${entry.archs}`),
    ...bad.map((entry) => `FAILED ${entry.file}: ${entry.error}`),
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = process.argv[2];
  if (!app) throw new Error('usage: node macho.js <path to .app>');
  const found = checkMachOs(path.resolve(app));
  console.log(describe(found));
  if (!found.length || found.some((entry) => entry.error)) process.exit(1);
}
