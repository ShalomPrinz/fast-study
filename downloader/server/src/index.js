import express from 'express';
import cors from 'cors';
import { PORT, DATABASE_URL, EXTENSION_ID, FRONTEND_URL } from './config.js';
import { emitError } from './progress.js';
import { serve, requireSecret } from '@faststudy/runtime';
import { checkTools } from '@faststudy/tools';
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
    // 'app://bundle' is the packaged app's frozen origin: an app:// page sends it host-only,
    // with no trailing slash (Electron's permission-handler API reports it differently).
    // The extension origin appears only for a dev who set DOWNLOADER_EXTENSION_ID.
    origin: [
      ...(EXTENSION_ID ? [`chrome-extension://${EXTENSION_ID}`] : []),
      FRONTEND_URL,
      'app://bundle',
    ],
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

// The external binaries this service spawns. Probed once at startup, never per request: the boot
// screen polls /health, and re-spawning them per poll would cost more than the answer is worth.
// A tool installed afterwards is picked up on the next launch.
const TOOLS = ['yt-dlp', 'curl'];
let toolStatus = {};

// Liveness plus the boot-time tool probe: what the launcher waits on before opening the window,
// and what its boot screen renders a missing binary from.
app.get('/health', (req, res) => res.json({ status: 'ok', tools: toolStatus }));

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

checkTools(TOOLS).then((status) => {
  toolStatus = status;
  for (const [name, state] of Object.entries(status)) {
    if (state !== 'ok') console.error(`❌ ${name} is ${state} — the downloads that need it will fail`);
  }
});

serve(app, PORT, (port) => {
  console.log(`\n==========================================`);
  console.log(`🎧 Downloader listening on port ${port}`);
  console.log(`📁 DATABASE_URL: ${DATABASE_URL}`);
  console.log(`==========================================\n`);
});
