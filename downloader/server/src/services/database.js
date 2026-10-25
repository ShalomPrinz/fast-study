import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DATABASE_URL, VIDEO_FILENAME, MATERIAL_TEMP_FILENAME } from '../config.js';
import { emitLog, emitError } from '../progress.js';
import { peerHeaders } from '@faststudy/runtime';
import { reportVideoArrived } from './backend.js';

// All DATABASE_URL I/O lives here. Contract details (video PUT wipes derived
// artifacts vs appending /materials, /tree reshape, notify) in docs/DATABASE.md.

// A store that didn't happen, in the one shape both its channels carry: the 502 body of
// /upload-pdf and a job's terminal failure (docs/JOBS.md). `error` stays the database's own text.
function storeFailed(detail) {
  return { error: detail, code: 'database_store_failed', params: { detail } };
}

// A database refusal: its own code/params pass through as-is (the frontend already catalogs them);
// `database_store_failed` is only for a body that carries no code.
function refused(body, status) {
  const error = body?.error ?? `HTTP ${status}`;
  if (!body?.code) return storeFailed(error);
  return { error, code: body.code, params: body.params ?? {} };
}

// /tree returns rich lecture/recitation objects; the popup only wants the names and each course's
// resolved `lectures_only`, and archived courses are dropped so finished ones don't clutter suggestions.
export async function listCourses() {
  const res = await fetch(`${DATABASE_URL}/tree`, { headers: peerHeaders() });
  if (!res.ok) throw new Error(`database /tree returned ${res.status}`);
  const tree = await res.json();
  return tree
    .filter((c) => !c.archived)
    .map((c) => ({
      name: c.name,
      lectures_only: c.lectures_only === true,
      lectures: (c.lectures ?? []).map((l) => l.name),
      recitations: (c.recitations ?? []).map((r) => r.name),
    }));
}

// The live global course-structure mode, `{course_structure}` — what a course not in the tree yet resolves to.
export async function getCourseStructure() {
  const res = await fetch(`${DATABASE_URL}/course_structure`, { headers: peerHeaders() });
  if (!res.ok) throw new Error(`database /course_structure returned ${res.status}`);
  const { course_structure } = await res.json();
  return { course_structure };
}

// Create the course so the extension can target a new one; 409 `name_taken` means it exists, also success.
// Null on success, else the refusal body. Throws on a network error.
export async function ensureCourse(course) {
  const res = await fetch(`${DATABASE_URL}/courses`, {
    method: 'POST',
    headers: peerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: course, source_url: null }),
  });
  if (res.ok) {
    emitLog(`📁 Created course ${course}`);
    return null;
  }
  const body = await res.json().catch(() => null);
  if (res.status === 409 && body?.code === 'name_taken') return null;
  const failure = refused(body, res.status);
  emitError(`❌ Creating course ${course} failed: ${failure.error}`);
  return failure;
}

// Stream the temp video.mp4 to the database (a PUT that wipes derived artifacts), removing the
// temp dir either way. Never throws: null on success, else the job's failure.
export async function uploadVideo(tempDir, course, lecture, kind, tool) {
  const file = path.join(tempDir, VIDEO_FILENAME);
  try {
    const url = `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/video?kind=${encodeURIComponent(kind)}`;
    // duplex: 'half' is required when a fetch body is a stream (undici).
    const res = await fetch(url, {
      method: 'PUT',
      headers: peerHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: Readable.toWeb(fs.createReadStream(file)),
      duplex: 'half',
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) {
      const failure = refused(body, res.status);
      emitError(`❌ ${tool} upload to database failed: ${failure.error}`);
      return failure;
    }
    emitLog(`✅ Uploaded ${VIDEO_FILENAME} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
    // Only a video PUT announces itself: it is what the backend's auto-run policy acts on, and a
    // material POST deliberately starts nothing.
    reportVideoArrived(course, lecture, kind);
    return null;
  } catch (err) {
    // undici's message is a bare "fetch failed"; the cause (a missing file, a reset) is the reason.
    const reason = err.cause?.message ?? err.message;
    emitError(`❌ ${tool} upload to database failed: ${reason}`);
    return storeFailed(reason);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// The appending /materials URL. `source` is the discovery row's ref, stored as the material's
// identity so the frontend can match the row; a download from no row sends none.
// `filename` is the original name (display, and the database's disk extension); none sends none.
export function materialsUrl(course, lecture, kind, source = null, filename = null) {
  let url = `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/materials?kind=${encodeURIComponent(kind)}`;
  if (source) url += `&source=${encodeURIComponent(source)}`;
  if (filename) url += `&filename=${encodeURIComponent(filename)}`;
  return url;
}

// Stream the temp file to the appending /materials, removing the temp dir either way. Never
// throws: null on success, else the job's failure.
export async function uploadMaterial(
  tempDir,
  course,
  lecture,
  kind,
  tool,
  source = null,
  filename = null,
) {
  const file = path.join(tempDir, MATERIAL_TEMP_FILENAME);
  try {
    const url = materialsUrl(course, lecture, kind, source, filename);
    // duplex: 'half' is required when a fetch body is a stream (undici).
    const res = await fetch(url, {
      method: 'POST',
      headers: peerHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: Readable.toWeb(fs.createReadStream(file)),
      duplex: 'half',
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) {
      const failure = refused(body, res.status);
      emitError(`❌ ${tool} upload to database failed: ${failure.error}`);
      return failure;
    }
    emitLog(`✅ Uploaded ${body?.name} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
    return null;
  } catch (err) {
    // undici's message is a bare "fetch failed"; the cause (a missing file, a reset) is the reason.
    const reason = err.cause?.message ?? err.message;
    emitError(`❌ ${tool} upload to database failed: ${reason}`);
    return storeFailed(reason);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Forward already-fetched PDF bytes to /materials. Throws on a network error (route → 500);
// returns the failure body on a database-level failure (route → 502).
export async function uploadPdf(buf, course, lecture, kind) {
  const url = materialsUrl(course, lecture, kind);
  const res = await fetch(url, {
    method: 'POST',
    headers: peerHeaders({ 'Content-Type': 'application/pdf' }),
    body: buf,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    const failure = refused(body, res.status);
    emitError(`❌ PDF upload to database failed: ${failure.error}`);
    return failure;
  }
  emitLog(`✅ Uploaded ${body?.name} to database (${course}/${lecture}, kind=${kind})`);
  notifyFrontend();
  return null;
}

// Non-blocking ping so subscribed sidebars refetch the tree; silent on failure so a
// download still counts as done when the frontend is down.
export function notifyFrontend() {
  fetch(`${DATABASE_URL}/notify`, {
    method: 'POST',
    headers: peerHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
  }).catch(() => {});
}
