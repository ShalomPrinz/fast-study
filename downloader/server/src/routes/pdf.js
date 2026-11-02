import path from 'node:path';
import { Router } from 'express';
import express from 'express';
import { ensureCourse, uploadPdf } from '../services/database.js';
import { emitLog, formatBytes } from '../progress.js';
import { invalidRequest, storedName, validateKind } from '../validate.js';
import { folderTarget, writeIntoFolder } from '../generalFolder.js';

const router = Router();

// The material types the backend accepts (backend/pipeline/material_types.py), with the content type
// the database is sent; it picks the disk extension from `filename`, not from this.
export const FILE_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// `?filename=` of /upload-file → `{filename, ext, stem}` or `{body}` (the 400 to send).
export function parseFilename(raw) {
  const filename = typeof raw === 'string' ? raw.trim() : '';
  if (!filename) return { body: invalidRequest('filename', 'filename is required') };
  const ext = path.extname(filename).toLowerCase();
  if (!Object.hasOwn(FILE_TYPES, ext))
    return { body: invalidRequest('filename', `unsupported file type: ${ext || filename}`) };
  return { filename, ext, stem: filename.slice(0, -ext.length) };
}

// General mode: the bytes go into the persisted folder as `<stem><ext>`, synchronously, never
// to the database. Answers the name actually written, ` (2)` and all.
function saveToFolder(req, res, stemName, field, ext, status) {
  const target = folderTarget(stemName, field);
  if (target.body) return res.status(target.status).json(target.body);
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json(invalidRequest('body', 'empty body'));
  }
  const { fileName, failure } = writeIntoFolder(buf, target.folder, target.stem, ext);
  if (failure) return res.status(500).json(failure);
  res.json({ status, folder: target.folder, fileName });
}

// Shared by /upload-pdf and /upload-file; `file` is `{ext, filename, stem, contentType, label}`, where
// `filename` (null for a PDF) is forwarded to the database and `stem` (absent for a PDF, which takes
// `?fileName=`) names the General-mode file.
async function receive(req, res, file) {
  if (req.query.dest === 'folder')
    return file.stem === undefined
      ? saveToFolder(req, res, req.query.fileName, 'fileName', file.ext, `${file.label} saved`)
      : saveToFolder(req, res, file.stem, 'filename', file.ext, `${file.label} saved`);
  if (req.query.dest !== undefined && req.query.dest !== 'app')
    return res.status(400).json(invalidRequest('dest', `invalid dest: ${req.query.dest}`));
  const { course: rawCourse = '', lecture: rawLecture = '', kind = 'lecture' } = req.query;
  // The stored spelling from here on, so the log line and the PUT agree with disk.
  const course = storedName(rawCourse);
  const lecture = storedName(rawLecture);
  if (!course || !lecture) {
    return res
      .status(400)
      .json(
        invalidRequest(
          course ? 'lecture' : 'course',
          'course and lecture with a legal character are required',
        ),
      );
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  const buf = req.body;
  emitLog(
    `\n📥 ${file.label} upload received: ${formatBytes(buf?.length ?? 0)} for ${course}/${lecture} (kind=${kind})`,
  );
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json(invalidRequest('body', 'empty body'));
  }

  // Network error throws -> 500 (error middleware); database-level failure -> 502.
  const courseError = await ensureCourse(course);
  if (courseError) return res.status(502).json(courseError);
  const uploadError = await uploadPdf(buf, course, lecture, kind, file.filename, file.contentType);
  if (uploadError) return res.status(502).json(uploadError);
  res.json({ status: `${file.label} uploaded`, target: `${course}/${lecture}` });
}

const rawBody = express.raw({ type: '*/*', limit: '1gb' });
const PDF = { ext: '.pdf', filename: null, contentType: FILE_TYPES['.pdf'], label: 'PDF' };

// The extension's service worker fetches the PDF itself (its session cookies authenticate) and streams
// the raw bytes here; express.raw collects them into a Buffer.
router.post('/upload-pdf', rawBody, (req, res) => receive(req, res, PDF));

// Same contract for any supported material type; `filename` is the original name, kept for the
// database and, in General mode, for the saved file (`<name>.<original ext>`).
router.post('/upload-file', rawBody, (req, res) => {
  const parsed = parseFilename(req.query.filename);
  if (parsed.body) return res.status(400).json(parsed.body);
  const { filename, ext, stem } = parsed;
  return receive(req, res, { ext, filename, stem, contentType: FILE_TYPES[ext], label: 'File' });
});

export default router;
