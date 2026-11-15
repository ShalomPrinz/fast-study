// What every Mach-O in an .app links against, read from its load commands. `node linkage.js <app>`
// prints the offenders; the macOS smoke suite runs the same walk on the installed bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { files, isMachO } from './macho.js';

const DYLIB_COMMANDS = new Set([0xc, 0x20, 0x80000018, 0x8000001f, 0x80000023]); // load, lazy, weak, reexport, upward
const LC_RPATH = 0x8000001c;
const MH_EXECUTE = 2;
const SYSTEM = ['/usr/lib/', '/System/'];

// /System/Volumes/Data is the data volume (/opt/homebrew lives under it), not the OS.
const isSystem = (p) =>
  SYSTEM.some((root) => p.startsWith(root)) && !p.startsWith('/System/Volumes/');
const within = (p, dir) => p === dir || p.startsWith(dir + path.sep);

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  const got = fs.readSync(fd, buf, 0, length, offset);
  return got < length ? buf.subarray(0, got) : buf;
}

/** One slice's header at `base`: `{ cpu, filetype, dylibs, rpaths }`, or null when it is not a little-endian Mach-O. */
function readSlice(fd, base) {
  const head = readAt(fd, base, 32);
  const magic = head.length >= 4 ? head.readUInt32LE(0) : 0;
  if (magic !== 0xfeedfacf && magic !== 0xfeedface) return null;
  const size = magic === 0xfeedfacf ? 32 : 28;
  const ncmds = head.readUInt32LE(16);
  const cmds = readAt(fd, base + size, head.readUInt32LE(20));
  const slice = {
    cpu: head.readUInt32LE(4),
    filetype: head.readUInt32LE(12),
    dylibs: [],
    rpaths: [],
  };
  let at = 0;
  for (let i = 0; i < ncmds && at + 8 <= cmds.length; i++) {
    const cmd = cmds.readUInt32LE(at);
    const cmdsize = cmds.readUInt32LE(at + 4);
    if (cmdsize < 8) break;
    if (DYLIB_COMMANDS.has(cmd) || cmd === LC_RPATH) {
      const start = at + cmds.readUInt32LE(at + 8);
      const end = cmds.indexOf(0, start);
      const text = cmds.toString(
        'utf8',
        start,
        end < 0 ? at + cmdsize : Math.min(end, at + cmdsize),
      );
      (cmd === LC_RPATH ? slice.rpaths : slice.dylibs).push(text);
    }
    at += cmdsize;
  }
  return slice;
}

/** Every slice of a thin or fat Mach-O at `file`; `[]` when it is neither. */
export function readSlices(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = readAt(fd, 0, 8);
    if (head.length < 8) return [];
    const magic = head.readUInt32BE(0);
    if (magic !== 0xcafebabe && magic !== 0xcafebabf) {
      const slice = readSlice(fd, 0);
      return slice ? [slice] : [];
    }
    const wide = magic === 0xcafebabf;
    const entry = wide ? 32 : 20;
    const table = readAt(fd, 8, head.readUInt32BE(4) * entry);
    const slices = [];
    for (let at = 0; at + entry <= table.length; at += entry) {
      const offset = wide ? Number(table.readBigUInt64BE(at + 8)) : table.readUInt32BE(at + 8);
      const slice = readSlice(fd, offset);
      if (slice) slices.push(slice);
    }
    return slices;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Walk `app` the way dyld loads it: from every executable (the app, each helper, the PyInstaller
 * bootloader, the tools) along its dependencies, a dependency's `@rpath` searching the rpaths of the
 * whole chain above it and `@executable_path` meaning that executable. A Mach-O no executable reaches
 * is a dlopen target (a Python extension): its own rpaths plus those of the nearest executable up the
 * tree, which is also its `@executable_path`. Returns `{ checked, roots, rpaths, failures }` with each
 * failure `{ file, offenders }` (file relative to `app`).
 * Kept simple: `@loader_path` and rpaths expand against the real path, dlopen takes the nearest
 * executable up the tree and not whichever loads it, and a weak link is held to the same bar.
 */
export function checkLinkage(app) {
  const bundle = fs.realpathSync(app);
  const mainExe = path.join(bundle, 'Contents', 'MacOS', path.basename(app, '.app'));
  const cache = new Map();
  const slicesOf = (file) => {
    if (!cache.has(file)) cache.set(file, readSlices(file));
    return cache.get(file);
  };
  const machos = [...files(bundle)].filter((file) => isMachO(file) && slicesOf(file).length);
  const execs = machos.filter((file) => slicesOf(file).some((s) => s.filetype === MH_EXECUTE));
  const execInDir = new Map();
  for (const exe of execs)
    if (!execInDir.has(path.dirname(exe))) execInDir.set(path.dirname(exe), exe);

  // The bundle file `p` names, symlinks followed, or null.
  const find = (p) => {
    try {
      const real = fs.realpathSync(p);
      return fs.statSync(real).isFile() && within(real, bundle) ? real : null;
    } catch {
      return null;
    }
  };
  const out = { checked: machos.length, roots: new Set(), rpaths: new Set(), failures: [] };
  const bad = new Map();
  const report = (file, reason) => {
    if (!bad.has(file)) bad.set(file, new Set());
    bad.get(file).add(reason);
  };
  const reached = new Set();
  const seen = new Set();

  function visit(file, cpu, inherited, exe) {
    const slice = slicesOf(file).find((s) => s.cpu === cpu);
    if (!slice) return;
    const expand = (p) => {
      if (p.startsWith('@loader_path')) return path.resolve(path.dirname(file) + p.slice(12));
      if (p.startsWith('@executable_path')) return path.resolve(path.dirname(exe) + p.slice(16));
      return p;
    };
    // dyld searches the image's own LC_RPATHs first, then the chain that loaded it.
    const stack = new Set();
    for (const rpath of slice.rpaths) {
      out.rpaths.add(rpath);
      const full = path.normalize(expand(rpath));
      if (path.isAbsolute(full) && (within(full, bundle) || isSystem(full + '/'))) stack.add(full);
      else report(file, `LC_RPATH ${rpath}`);
    }
    for (const root of inherited) stack.add(root);
    const key = [file, cpu, exe, ...[...stack].sort()].join('\n');
    if (seen.has(key)) return;
    seen.add(key);
    for (const name of slice.dylibs) {
      out.roots.add(
        name.startsWith('/') ? name.split('/').slice(0, 3).join('/') : name.split('/')[0],
      );
      let target = null;
      let ok;
      if (name.startsWith('@rpath/')) {
        for (const root of stack) {
          target = find(path.join(root, name.slice(7)));
          if (target) break;
        }
        // Only the Swift runtime lives in the shared cache behind an rpath, so only it may resolve off disk.
        ok =
          !!target ||
          (path.basename(name).startsWith('libswift') &&
            [...stack].some((root) => isSystem(root + '/')));
      } else if (name.startsWith('@loader_path') || name.startsWith('@executable_path')) {
        target = find(expand(name));
        ok = !!target;
      } else {
        ok = path.isAbsolute(name) && isSystem(path.normalize(name));
      }
      if (!ok) report(file, `link ${name}`);
      else if (target && slicesOf(target).length) {
        reached.add(target);
        visit(target, cpu, stack, exe);
      }
    }
  }

  for (const exe of execs) {
    reached.add(exe);
    for (const slice of slicesOf(exe)) visit(exe, slice.cpu, new Set(), exe);
  }
  for (const file of machos.filter((f) => !reached.has(f))) {
    let dir = path.dirname(file);
    while (dir.length > bundle.length && !execInDir.has(dir)) dir = path.dirname(dir);
    const exe = execInDir.get(dir) ?? (execs.includes(mainExe) ? mainExe : file);
    for (const slice of slicesOf(file)) {
      const own = slicesOf(exe).find((s) => s.cpu === slice.cpu);
      const outer = new Set();
      for (const rpath of own?.rpaths ?? []) {
        if (rpath.startsWith('@loader_path'))
          outer.add(path.resolve(path.dirname(exe) + rpath.slice(12)));
        else if (rpath.startsWith('@executable_path'))
          outer.add(path.resolve(path.dirname(exe) + rpath.slice(16)));
        else outer.add(rpath);
      }
      visit(file, slice.cpu, outer, exe);
    }
  }
  for (const [file, reasons] of bad)
    out.failures.push({ file: path.relative(bundle, file), offenders: [...reasons] });
  return out;
}

/** The walk as text: the count, the link roots and rpaths seen, and every offender. */
export function describe({ checked, roots, rpaths, failures }) {
  return [
    `${checked} Mach-O files, ${failures.length} with an offending link or rpath`,
    `link roots: ${[...roots].sort().join(' ')}`,
    `rpaths: ${[...rpaths].sort().join(' ')}`,
    `offenders: ${failures.length ? '' : 'none'}`,
    ...failures.map((f) => `${f.file}: ${f.offenders.join(', ')}`),
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = process.argv[2];
  if (!app) throw new Error('usage: node linkage.js <path to .app>');
  const found = checkLinkage(path.resolve(app));
  console.log(describe(found));
  if (!found.checked || found.failures.length) process.exit(1);
}
