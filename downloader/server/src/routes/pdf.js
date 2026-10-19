import { Router } from 'express';
import express from 'express';
import { ensureCourse, uploadPdf } from '../services/database.js';
import { emitLog, formatBytes } from '../progress.js';
import { invalidRequest, storedName, validateKind } from '../validate.js';
import { folderTarget, writeIntoFolder } from '../generalFolder.js';

const router = Router();

// General mode: the bytes go into the persisted folder as `<fileName>.pdf`, synchronously, never
// to the database. Answers the name actually written, ` (2)` and all.
function saveToFolder(req, res) {
  const target = folderTarget(req.query.fileName);
  if (target.body) return res.status(target.status).json(target.body);
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json(invalidRequest('body', 'empty body'));
  }
  const { fileName, failure } = writeIntoFolder(buf, target.folder, target.stem, '.pdf');
  if (failure) return res.status(500).json(failure);
  res.json({ status: 'PDF saved', folder: target.folder, fileName });
}

// The popup fetches the PDF itself (its session cookies authenticate) and streams
// the raw bytes here; express.raw collects them into a Buffer.
router.post('/upload-pdf', express.raw({ type: '*/*', limit: '1gb' }), async (req, res) => {
  if (req.query.dest === 'folder') return saveToFolder(req, res);
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
    `\n📥 PDF upload received: ${formatBytes(buf?.length ?? 0)} for ${course}/${lecture} (kind=${kind})`,
  );
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json(invalidRequest('body', 'empty body'));
  }

  // Network error throws -> 500 (error middleware); database-level failure -> 502.
  const courseError = await ensureCourse(course);
  if (courseError) return res.status(502).json(courseError);
  const uploadError = await uploadPdf(buf, course, lecture, kind);
  if (uploadError) return res.status(502).json(uploadError);
  res.json({ status: 'PDF uploaded', target: `${course}/${lecture}` });
});

export default router;
