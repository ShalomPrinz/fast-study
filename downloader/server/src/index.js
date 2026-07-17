import express from 'express';
import cors from 'cors';
import { PORT, DATABASE_URL, EXTENSION_ID } from './config.js';
import { emitError } from './progress.js';
import coursesRouter from './routes/courses.js';
import probeRouter from './routes/probe.js';
import downloadRouter from './routes/download.js';
import pdfRouter from './routes/pdf.js';

const app = express();

// Locked to the one extension origin; cors also answers OPTIONS preflight.
app.use(cors({
  origin: `chrome-extension://${EXTENSION_ID}`,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
// JSON for probe/download; /upload-pdf parses its own raw body per-route.
app.use(express.json({ limit: '5mb' }));

app.use(coursesRouter);
app.use(probeRouter);
app.use(downloadRouter);
app.use(pdfRouter);

// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
app.use((err, req, res, next) => {
  emitError(err?.stack ?? String(err));
  res.status(500).json({ error: err.message ?? 'Server error' });
});

app.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🎧 Downloader listening on port ${PORT}`);
  console.log(`📁 DATABASE_URL: ${DATABASE_URL}`);
  console.log(`==========================================\n`);
});
