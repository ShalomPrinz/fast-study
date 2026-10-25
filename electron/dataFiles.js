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

/** Resolve a target to its absolute path through `database/` — `{ok: true, path}` or `{ok: false,
 *  error}`. Identifiers in: the renderer never hands main a path (docs/RENDERER.md). */
async function dataFilePath(target, { url, secret }) {
  if (!url) return { ok: false, error: 'the database service is not running' };
  try {
    const response = await fetch(`${url}${dataFileRoute(target ?? {})}`, {
      headers: { 'X-FastStudy-Secret': secret },
    });
    if (!response.ok) return { ok: false, error: `database answered ${response.status}` };
    const { path } = await response.json();
    return { ok: true, path };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** Windows' "Open with" chooser on one data file. Windows-only: off it, `unsupported` without asking
 *  the database. Settles on the child's `spawn` or `error` event, never on the call returning. */
async function openDataFileWith(target, database, platform = process.platform) {
  if (platform !== 'win32') return { ok: false, error: 'unsupported' };
  const resolved = await dataFilePath(target, database);
  if (!resolved.ok) return resolved;
  return new Promise((resolve) => {
    // An argv array, never a shell: the path is passed to rundll32 verbatim.
    const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', resolved.path], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, error: null });
    });
    child.once('error', (error) => resolve({ ok: false, error: error.message }));
  });
}

module.exports = { dataFilePath, dataFileRoute, openDataFileWith };
