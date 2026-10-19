// General-mode saving: the requested name's validation, collision-safe naming, and the persisted
// folder's default.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_FOLDER,
  fileStem,
  folderError,
  freeName,
  moveIntoFolder,
  readFolder,
  writeFolder,
  writeIntoFolder,
} from '../src/generalFolder.js';
import { createJob, listJobs, finishJob } from '../src/jobs.js';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-folder-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a fileName with a separator or traversal is rejected, not stripped', () => {
  for (const bad of ['../x', 'a/b', 'a\\b', '..', '.', '', '   ', 42, null]) {
    assert.equal(fileStem(bad), null, String(bad));
  }
});

test('a fileName keeps only Windows-legal characters', () => {
  assert.equal(fileStem('Lecture: 3?'), 'Lecture 3');
  assert.equal(fileStem('  name. '), 'name');
  assert.equal(fileStem('CON'), 'CON_');
});

test('a collision appends (2), (3)…', () => {
  const taken = new Set(['a.mp4', 'a (2).mp4']);
  assert.equal(
    freeName('a', '.mp4', (n) => taken.has(n)),
    'a (3).mp4',
  );
  assert.equal(
    freeName('b', '.mp4', (n) => taken.has(n)),
    'b.mp4',
  );
});

test('an extension the user typed is not doubled', () => {
  assert.equal(
    freeName('notes.PDF', '.pdf', () => false),
    'notes.pdf',
  );
});

test('the folder defaults to ~/Downloads when nothing usable is saved', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'state', 'general-folder.json');
  assert.equal(DEFAULT_FOLDER, path.join(os.homedir(), 'Downloads'));
  assert.equal(readFolder(file), DEFAULT_FOLDER);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '{not json');
  assert.equal(readFolder(file), DEFAULT_FOLDER);
  fs.writeFileSync(file, JSON.stringify({ folder: 'relative/dir' }));
  assert.equal(readFolder(file), DEFAULT_FOLDER);
});

test('a written folder reads back', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'nested', 'general-folder.json');
  writeFolder(dir, file);
  assert.equal(readFolder(file), dir);
});

test('folderError: relative, missing and file paths are refused with typed codes', (t) => {
  const dir = scratch(t);
  assert.equal(folderError(dir), null);
  assert.equal(folderError('rel/dir').code, 'invalid_request');
  assert.equal(folderError(path.join(dir, 'nope')).code, 'general_folder_missing');
  const file = path.join(dir, 'f');
  fs.writeFileSync(file, '');
  assert.equal(folderError(file).code, 'general_folder_missing');
});

test('moving twice into one folder never overwrites', async (t) => {
  const dir = scratch(t);
  for (const body of ['one', 'two']) {
    const src = path.join(dir, `video-${body}.mp4`);
    fs.writeFileSync(src, body);
    await moveIntoFolder(src, dir, 'Talk');
  }
  assert.equal(fs.readFileSync(path.join(dir, 'Talk.mp4'), 'utf8'), 'one');
  assert.equal(fs.readFileSync(path.join(dir, 'Talk (2).mp4'), 'utf8'), 'two');
});

test('a move into a missing folder is a typed failure', async (t) => {
  const dir = scratch(t);
  const src = path.join(dir, 'video.mp4');
  fs.writeFileSync(src, 'x');
  const { failure } = await moveIntoFolder(src, path.join(dir, 'gone'), 'Talk');
  assert.equal(failure.code, 'general_folder_save_failed');
  assert.equal(failure.params.folder, path.join(dir, 'gone'));
});

test('a cross-drive move copies, and a failed copy leaves nothing behind', async (t) => {
  const dir = scratch(t);
  const src = path.join(dir, 'video.mp4');
  fs.writeFileSync(src, 'x');
  const exdev = Object.assign(new Error('cross-device'), { code: 'EXDEV' });
  t.mock.method(fs.promises, 'rename', async () => {
    throw exdev;
  });
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  assert.deepEqual(await moveIntoFolder(src, out, 'Talk'), { fileName: 'Talk.mp4' });
  assert.ok(!fs.existsSync(src), 'the source is unlinked after the copy');

  fs.writeFileSync(src, 'y');
  t.mock.method(fs.promises, 'copyFile', async (from, to) => {
    fs.writeFileSync(to, 'partial');
    throw new Error('disk full');
  });
  const { failure } = await moveIntoFolder(src, out, 'Talk');
  assert.equal(failure.code, 'general_folder_save_failed');
  assert.deepEqual(fs.readdirSync(out), ['Talk.mp4'], 'the partial (2) is removed');
});

test('written bytes land under a free name', (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'Notes.pdf'), 'old');
  const { fileName } = writeIntoFolder(Buffer.from('new'), dir, 'Notes', '.pdf');
  assert.equal(fileName, 'Notes (2).pdf');
  assert.equal(fs.readFileSync(path.join(dir, 'Notes.pdf'), 'utf8'), 'old');
});

test('a folder job and an app job never supersede each other', () => {
  const app = createJob({ course: 'C', lecture: 'L9', kind: 'lecture', tool: 'curl' });
  finishJob(app, 'error', 'x');
  const folder = createJob({ tool: 'curl', dest: 'folder', folder: '/d', fileName: 'L9' });
  finishJob(folder, 'error', 'x');
  const ids = listJobs().map((j) => j.id);
  assert.ok(ids.includes(app) && ids.includes(folder));

  const retry = createJob({ tool: 'curl', dest: 'folder', folder: '/d', fileName: 'L9' });
  const jobs = listJobs();
  assert.ok(!jobs.some((j) => j.id === folder), 'the same folder target supersedes');
  assert.ok(jobs.some((j) => j.id === app));
  const snap = jobs.find((j) => j.id === retry);
  assert.deepEqual(
    { dest: snap.dest, folder: snap.folder, fileName: snap.fileName, course: snap.course },
    { dest: 'folder', folder: '/d', fileName: 'L9', course: null },
  );
  assert.equal(jobs.find((j) => j.id === app).dest, 'app');
});

test('folder:pick reaches picker streams only, and only they count', async () => {
  const { EventEmitter } = await import('node:events');
  const { subscribe, pickerCount, broadcastFolderPick } = await import('../src/events.js');
  const stream = (picker) => {
    const res = Object.assign(new EventEmitter(), { frames: [] });
    res.writeHead = () => {};
    res.write = (f) => res.frames.push(f);
    subscribe(res, { picker });
    return res;
  };
  const plain = stream(false);
  assert.equal(pickerCount(), 0);
  const picker = stream(true);
  assert.equal(pickerCount(), 1);
  broadcastFolderPick('/d');
  assert.ok(picker.frames.includes('event: folder:pick\ndata: {"folder":"/d"}\n\n'));
  assert.ok(!plain.frames.some((f) => f.startsWith('event: folder:pick')));
  picker.emit('close');
  plain.emit('close');
  assert.equal(pickerCount(), 0);
});
