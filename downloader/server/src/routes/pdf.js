import { Router } from 'express';
import express from 'express';
import { uploadPdf } from '../services/database.js';
import { emitLog, formatBytes } from '../progress.js';
import { isSafeName, validateKind } from '../validate.js';

const router = Router();

// The popup fetches the PDF itself (its session cookies authenticate) and streams
// the raw bytes here; express.raw collects them into a Buffer.
router.post('/upload-pdf', express.raw({ type: '*/*', limit: '1gb' }), async (req, res) => {
  const { course = '', lecture = '', kind = 'lecture' } = req.query;
  if (!isSafeName(course) || !isSafeName(lecture)) {
    return res.status(400).json({ error: 'course and lecture are required' });
  }
  const kindErr = validateKind(kind);
  if (kindErr) return res.status(400).json(kindErr);

  const buf = req.body;
  emitLog(
    `\n📥 PDF upload received: ${formatBytes(buf?.length ?? 0)} for ${course}/${lecture} (kind=${kind})`,
  );
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: 'empty body' });
  }

  // Network error throws -> 500 (error middleware); database-level failure -> 502.
  const uploadError = await uploadPdf(buf, course, lecture, kind);
  if (uploadError) return res.status(502).json({ error: uploadError });
  res.json({ status: 'PDF uploaded', target: `${course}/${lecture}` });
});

export default router;
