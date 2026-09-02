import express from 'express';
import cors from 'cors';
import { PORT, DATABASE_URL, EXTENSION_ID, FRONTEND_URL } from './config.js';
import { emitError } from './progress.js';
import { serve, requireSecret } from './runtime.js';
import coursesRouter from './routes/courses.js';
import probeRouter from './routes/probe.js';
import downloadRouter from './routes/download.js';
import downloadItemRouter from './routes/downloadItem.js';
import jobsRouter from './routes/jobs.js';
import runsRouter from './routes/runs.js';
import pdfRouter from './routes/pdf.js';

const app = express();

app.use(
  cors({
    origin: [`chrome-extension://${EXTENSION_ID}`, FRONTEND_URL],
    methods: ['GET', 'POST', 'OPTIONS'],
    // A pinned allowedHeaders list is exhaustive: without X-FastStudy-Secret named here the
    // preflight strips it and every call fails as a CORS error rather than an auth one.
    allowedHeaders: ['Content-Type', 'X-FastStudy-Secret'],
  }),
);
// After cors, which answers the preflight itself, so no OPTIONS ever reaches the guard.
app.use(requireSecret);
// JSON for probe/download; /upload-pdf parses its own raw body per-route.
app.use(express.json({ limit: '5mb' }));

// Liveness only: what the launcher waits on before opening the window.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(coursesRouter);
app.use(probeRouter);
app.use(downloadRouter);
app.use(downloadItemRouter);
app.use(jobsRouter);
app.use(runsRouter);
app.use(pdfRouter);

// The unused `next` is load-bearing: express identifies error handlers by arity.
app.use((err, req, res, next) => {
  emitError(err?.stack ?? String(err));
  res.status(500).json({ error: err.message ?? 'Server error' });
});

serve(app, PORT, (port) => {
  console.log(`\n==========================================`);
  console.log(`🎧 Downloader listening on port ${port}`);
  console.log(`📁 DATABASE_URL: ${DATABASE_URL}`);
  console.log(`==========================================\n`);
});
