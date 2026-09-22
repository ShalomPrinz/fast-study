import fs from 'node:fs';
import path from 'node:path';

const IMPORT_DIR = 1;
const DELAY_IMPORT_DIR = 13;

/** The DLL names a PE file imports, normal and delay-loaded, as written; null when it is not a PE. */
export function importedDlls(file) {
  const fd = fs.openSync(file, 'r');
  try {
    return parse(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function parse(fd) {
  const size = fs.fstatSync(fd).size;
  const read = (offset, length) => {
    const buf = Buffer.alloc(length);
    const got = offset >= 0 && offset < size ? fs.readSync(fd, buf, 0, length, offset) : 0;
    return buf.subarray(0, got);
  };

  const dos = read(0, 64);
  if (dos.length < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return null;
  const peAt = dos.readUInt32LE(0x3c);
  const coff = read(peAt, 24);
  if (coff.length < 24 || coff.toString('latin1', 0, 4) !== 'PE\0\0') return null;
  const sectionCount = coff.readUInt16LE(6);
  const optSize = coff.readUInt16LE(20);
  const opt = read(peAt + 24, optSize);
  if (opt.length < optSize || optSize < 2) return null;

  const magic = opt.readUInt16LE(0);
  if (magic !== 0x10b && magic !== 0x20b) return null;
  const plus = magic === 0x20b;
  const imageBase = plus ? Number(opt.readBigUInt64LE(24)) : opt.readUInt32LE(28);
  const dirCount = opt.readUInt32LE(plus ? 108 : 92);
  const dirsAt = plus ? 112 : 96;
  const dirRva = (index) =>
    index < dirCount && dirsAt + index * 8 + 8 <= opt.length
      ? opt.readUInt32LE(dirsAt + index * 8)
      : 0;

  const table = read(peAt + 24 + optSize, sectionCount * 40);
  const sections = [];
  for (let at = 0; at + 40 <= table.length; at += 40) {
    const virtualSize = table.readUInt32LE(at + 8);
    const rawSize = table.readUInt32LE(at + 16);
    sections.push({
      va: table.readUInt32LE(at + 12),
      span: Math.max(virtualSize, rawSize),
      raw: table.readUInt32LE(at + 20),
    });
  }
  const offsetOf = (rva) => {
    const s = sections.find((sec) => rva >= sec.va && rva < sec.va + sec.span);
    return s ? rva - s.va + s.raw : -1;
  };
  const stringAt = (rva) => {
    const buf = read(offsetOf(rva), 256);
    const end = buf.indexOf(0);
    return buf.toString('latin1', 0, end < 0 ? buf.length : end);
  };

  // Walks a descriptor array until its all-zero terminator, answering each descriptor's DLL name.
  const walk = (dirIndex, stride, nameRvaOf) => {
    const names = [];
    const start = offsetOf(dirRva(dirIndex));
    if (start < 0 || dirRva(dirIndex) === 0) return names;
    for (let at = start; ; at += stride) {
      const desc = read(at, stride);
      if (desc.length < stride || desc.every((b) => b === 0)) break;
      const rva = nameRvaOf(desc);
      if (rva) names.push(stringAt(rva));
    }
    return names;
  };

  const imports = walk(IMPORT_DIR, 20, (d) => d.readUInt32LE(12));
  // A delay descriptor without the RVA-based attribute bit (pre-VC7 linkers) holds VAs instead.
  const delayed = walk(DELAY_IMPORT_DIR, 32, (d) => {
    const name = d.readUInt32LE(4);
    return d.readUInt32LE(0) & 1 || !name ? name : name - imageBase;
  });
  return [...imports, ...delayed].filter(Boolean);
}

const PE_EXTENSIONS = new Set(['.exe', '.dll', '.pyd', '.node']);
const API_SET = /^(api-ms-win-|ext-ms-)/;
// The VC++ redistributables, which System32 holds only once some installer put them there. Only the
// versioned names: msvcrt, msvcp_win, mfc42 and atl.dll are Windows' own.
const REDIST = /^(vcruntime|msvcp|msvcr|concrt|vcomp|vccorlib|mfc|atl)\d{3}/;

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/** Every PE under `root` whose imports resolve neither inside `root` nor to a non-redistributable
 *  DLL in `system32`, as `{ file, missing }` with `file` relative to `root`; `scanned` counts the PEs. */
export function unresolvedImports(root, system32) {
  const files = [...walkFiles(root)];
  const shipped = new Set(files.map((file) => path.basename(file).toLowerCase()));
  const system = new Set(fs.readdirSync(system32).map((name) => name.toLowerCase()));
  const resolves = (dll) =>
    shipped.has(dll) || API_SET.test(dll) || (system.has(dll) && !REDIST.test(dll));

  const failures = [];
  let scanned = 0;
  for (const file of files) {
    if (!PE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const dlls = importedDlls(file);
    if (!dlls) continue;
    scanned += 1;
    // A native addon imports node.exe by name; node-gyp's delay-load hook binds it to the host exe.
    const addon = path.extname(file).toLowerCase() === '.node';
    const missing = [...new Set(dlls.map((dll) => dll.toLowerCase()))].filter(
      (dll) => !resolves(dll) && !(addon && dll === 'node.exe'),
    );
    if (missing.length) failures.push({ file: path.relative(root, file), missing: missing.sort() });
  }
  return { scanned, failures };
}
