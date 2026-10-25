const { spawn } = require('node:child_process');

/** The database route answering `{path}` for one data-file target: assignment `{course, assignment,
 *  name}`, lecture `{course, lecture, name, kind}`, or else overview `{course, name}`. */
function dataFileRoute({ course, lecture, assignment, name, kind }) {
  const q = encodeURIComponent;
  if (assignment) return `/courses/${q(course)}/assignments/${q(assignment)}/files/${q(name)}/path`;
  if (lecture) {
    return `/courses/${q(course)}/lectures/${q(lecture)}/files/${q(name)}/path?kind=${q(kind ?? 'lecture')}`;
  }
  return `/courses/${q(course)}/overview/files/${q(name)}/path`;
}

/** Resolve a target to its absolute path through `database/` — `{path}` or `{error}`.
 *  Identifiers in: the renderer never hands main a path (docs/RENDERER.md). */
async function dataFilePath(target, { url, secret }) {
  if (!url) return { error: 'the database service is not running' };
  try {
    const response = await fetch(`${url}${dataFileRoute(target ?? {})}`, {
      headers: { 'X-FastStudy-Secret': secret },
    });
    if (!response.ok) return { error: `database answered ${response.status}` };
    const { path } = await response.json();
    return { path };
  } catch (error) {
    return { error: error.message };
  }
}

/** Windows' "Open with" chooser on one data file: `undefined` or `{error}`. Off Windows, `unsupported`
 *  without asking the database. Settles on the child's `spawn` or `error` event, never on the call. */
async function openDataFileWith(target, database, platform = process.platform) {
  if (platform !== 'win32') return { error: 'unsupported' };
  const { path, error } = await dataFilePath(target, database);
  if (error !== undefined) return { error };
  return new Promise((resolve) => {
    // An argv array, never a shell: the path is passed to rundll32 verbatim.
    const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', path], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', (failure) => resolve({ error: failure.message }));
  });
}

/** Select one data file in the OS file manager: `undefined` or `{error}`. `show` is injected so the
 *  tests run without Electron; `showItemInFolder` reports nothing, so a resolved path is success. */
async function revealDataFile(target, database, show) {
  const { path, error } = await dataFilePath(target, database);
  if (error !== undefined) return { error };
  show(path);
}

module.exports = { dataFilePath, dataFileRoute, openDataFileWith, revealDataFile };
