import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { statePath } from '@faststudy/runtime';
import { emitLog, emitError } from './progress.js';
import { setJobFileName } from './jobs.js';
import { invalidRequest, storedName } from './validate.js';

// "General video" mode: a download saved into a computer folder the user picked, never DATA_ROOT
// (docs/DOWNLOAD.md). The folder is this server's own state, so the popup only ever reads it.

export const DEFAULT_FOLDER = path.join(os.homedir(), 'Downloads');

const folderFile = () => statePath('general-folder.json');

// The persisted folder, or ~/Downloads when nothing (or nothing readable) was saved.
export function readFolder(file = folderFile()) {
  try {
    const { folder } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof folder === 'string' && path.isAbsolute(folder)) return folder;
  } catch {}
  return DEFAULT_FOLDER;
}

export function writeFolder(folder, file = folderFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ folder }));
}

// null when `folder` is an existing, writable directory; else the refusal body.
export function folderError(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder))
    return invalidRequest('folder', 'folder must be an absolute path');
  let stat = null;
  try {
    stat = fs.statSync(folder);
  } catch {}
  if (!stat?.isDirectory())
    return {
      error: `folder does not exist: ${folder}`,
      code: 'general_folder_missing',
      params: { folder },
    };
  try {
    fs.accessSync(folder, fs.constants.W_OK);
  } catch (err) {
    return {
      error: `folder is not writable: ${folder}`,
      code: 'general_folder_not_writable',
      params: { folder, detail: err.message },
    };
  }
  return null;
}

// The Windows-legal stem a requested file name saves as, or null — traversal and separators are
// rejected, not stripped (the same rule as a course name, `validate.js::storedName`).
export function fileStem(name) {
  return typeof name === 'string' ? storedName(name.trim()) : null;
}

// `stem.ext`, `stem (2).ext`, … — the first candidate `taken` says is free.
export function freeName(stem, ext, taken) {
  // A user who typed the extension themselves must not get `x.mp4.mp4`.
  const base =
    ext && stem.toLowerCase().endsWith(ext.toLowerCase()) ? stem.slice(0, -ext.length) : stem;
  for (let n = 1; ; n += 1) {
    const name = `${base}${n === 1 ? '' : ` (${n})`}${ext}`;
    if (!taken(name)) return name;
  }
}

// Claims a free name in `folder` with an exclusive create, so two jobs finishing together can never
// pick the same one; the caller then fills the placeholder. Never overwrites a user's file.
function claim(folder, stem, ext) {
  for (;;) {
    const name = freeName(stem, ext, (n) => fs.existsSync(path.join(folder, n)));
    try {
      fs.closeSync(fs.openSync(path.join(folder, name), 'wx'));
      return name;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

function saveFailed(folder, detail) {
  return {
    error: `couldn't save into ${folder}: ${detail}`,
    code: 'general_folder_save_failed',
    params: { folder, detail },
  };
}

// Moves `src` into `folder` under a free name from `stem` + its own extension → `{fileName}` or
// `{failure}`; never throws. Async: a cross-drive (EXDEV) copy of a multi-GB video must not block.
export async function moveIntoFolder(src, folder, stem) {
  let name = null;
  try {
    name = claim(folder, stem, path.extname(src));
    const dest = path.join(folder, name);
    try {
      await fs.promises.rename(src, dest);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src);
    }
    emitLog(`✅ Saved ${name} to ${folder}`);
    return { fileName: name };
  } catch (err) {
    // The claimed placeholder or a partial copy; the claim made it ours, so it is never a user's file.
    if (name) await fs.promises.rm(path.join(folder, name), { force: true });
    emitError(`❌ Saving into ${folder} failed: ${err.message}`);
    return { failure: saveFailed(folder, err.message) };
  }
}

// Writes already-fetched bytes into `folder` under a free `<stem><ext>`; same answer as above.
export function writeIntoFolder(buf, folder, stem, ext) {
  let name = null;
  try {
    name = claim(folder, stem, ext);
    fs.writeFileSync(path.join(folder, name), buf);
    emitLog(`✅ Saved ${name} to ${folder}`);
    return { fileName: name };
  } catch (err) {
    if (name) fs.rmSync(path.join(folder, name), { force: true });
    emitError(`❌ Saving into ${folder} failed: ${err.message}`);
    return { failure: saveFailed(folder, err.message) };
  }
}

// The video a finished child left in its temp dir: the one `video.<ext>`, whichever ext yt-dlp chose
// (its pre-merge `video.f137.mp4` parts are gone by then).
export function outputFile(tempDir) {
  const found = fs.readdirSync(tempDir).find((f) => /^video\.[^.]+$/.test(f));
  return found ? path.join(tempDir, found) : null;
}

// The `dest:'folder'` half of a download request → `{folder, stem}` or `{status, body}` to refuse.
export function folderTarget(fileName) {
  const stem = fileStem(fileName);
  if (!stem)
    return {
      status: 400,
      body: invalidRequest('fileName', 'fileName with a legal character and no path is required'),
    };
  const folder = readFolder();
  const error = folderError(folder);
  if (error) return { status: 409, body: error };
  return { folder, stem };
}

// A folder job's last step (the runner's `save`): move the video into `folder`, removing the temp dir
// either way. Null on success, else the job's failure. Past the cancel signal, like an upload.
export function folderSaver(folder, stem) {
  return async (tempDir, jobId) => {
    try {
      const src = outputFile(tempDir);
      if (!src) return saveFailed(folder, 'the download left no video file');
      const { fileName, failure } = await moveIntoFolder(src, folder, stem);
      if (failure) return failure;
      setJobFileName(jobId, fileName);
      return null;
    } catch (err) {
      return saveFailed(folder, err.message);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  };
}
