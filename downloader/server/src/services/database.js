import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DATABASE_URL, VIDEO_FILENAME, MATERIAL_TEMP_FILENAME } from '../config.js';
import { emitLog, emitError } from '../progress.js';
import { peerHeaders } from '@faststudy/runtime';
import { reportVideoArrived } from './backend.js';

// All DATABASE_URL I/O lives here. Contract details (video PUT wipes derived
// artifacts vs appending /materials, /tree reshape, notify) in docs/DATABASE.md.

// /tree returns rich lecture/recitation objects; the popup only wants the names,
// and archived courses are dropped so finished ones don't clutter suggestions.
export async function listCourses() {
  const res = await fetch(`${DATABASE_URL}/tree`, { headers: peerHeaders() });
  if (!res.ok) throw new Error(`database /tree returned ${res.status}`);
  const tree = await res.json();
  return tree
    .filter((c) => !c.archived)
    .map((c) => ({
      name: c.name,
      lectures: (c.lectures ?? []).map((l) => l.name),
      recitations: (c.recitations ?? []).map((r) => r.name),
    }));
}

// Stream the temp video.mp4 to the database (a PUT that wipes derived artifacts), removing the
// temp dir either way. Never throws: null on success, else the job's error message.
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
      const error = body?.error ?? `HTTP ${res.status}`;
      emitError(`❌ ${tool} upload to database failed: ${error}`);
      return error;
    }
    emitLog(`✅ Uploaded ${VIDEO_FILENAME} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
    // Only a video PUT announces itself: it is what the backend's auto-run policy acts on, and a
    // material POST deliberately starts nothing.
    reportVideoArrived(course, lecture, kind);
    return null;
  } catch (err) {
    emitError(`❌ ${tool} upload to database failed: ${err.message}`);
    return err.message;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Stream the temp PDF to the appending /materials, removing the temp dir either way. Never
// throws: null on success, else the job's error message.
export async function uploadMaterial(tempDir, course, lecture, kind, tool) {
  const file = path.join(tempDir, MATERIAL_TEMP_FILENAME);
  try {
    const url = `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/materials?kind=${encodeURIComponent(kind)}`;
    // duplex: 'half' is required when a fetch body is a stream (undici).
    const res = await fetch(url, {
      method: 'POST',
      headers: peerHeaders({ 'Content-Type': 'application/pdf' }),
      body: Readable.toWeb(fs.createReadStream(file)),
      duplex: 'half',
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) {
      const error = body?.error ?? `HTTP ${res.status}`;
      emitError(`❌ ${tool} upload to database failed: ${error}`);
      return error;
    }
    emitLog(`✅ Uploaded ${body?.name} to database (${course}/${lecture}, kind=${kind})`);
    notifyFrontend();
    return null;
  } catch (err) {
    emitError(`❌ ${tool} upload to database failed: ${err.message}`);
    return err.message;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Forward already-fetched PDF bytes to /materials. Throws on a network error (route → 500);
// returns the message on a database-level failure (route → 502).
export async function uploadPdf(buf, course, lecture, kind) {
  const url = `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/materials?kind=${encodeURIComponent(kind)}`;
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
    const error = body?.error ?? `HTTP ${res.status}`;
    emitError(`❌ PDF upload to database failed: ${error}`);
    return error;
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
