import express from 'express';
import cors from 'cors';
import { ALLOWED_ORIGIN, AUTODL_PORT, SERVER_URL } from './src/lib/config.js';
import { UnsupportedError } from './src/lib/errors.js';
import { closeAllSessions } from './src/browser/browserSession.js';
import {
  sendUnsupported,
  handleAuthStatus,
  handleAuthConnect,
  handleAuthComplete,
  handleList,
  handleListExpand,
  handleDownloadItem,
  handleZoomPasscode,
  handleClose,
} from './src/http/server.js';

const app = express();
// cors handles the OPTIONS preflight for the single Vite origin; no manual short-circuit.
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }),
);
app.use(express.json()); // empty body → req.body = {} (matches the old JSON.parse(body || '{}'))

app.get('/auth/status', handleAuthStatus);
app.post('/auth/connect', handleAuthConnect);
app.post('/auth/complete', handleAuthComplete);
app.post('/list', handleList);
app.post('/list/expand', handleListExpand);
app.post('/download-item', handleDownloadItem);
app.post('/zoom/passcode', handleZoomPasscode);
app.post('/close', handleClose);

// Centralized error backstop: Express 5 forwards async-handler rejections here.
// A rethrown UnsupportedError maps to 422; anything else to 500.
app.use((err, req, res, next) => {
  console.error(err?.stack ?? String(err));
  if (err instanceof UnsupportedError) return sendUnsupported(res, err.message);
  res.status(500).json({ error: err.message ?? 'Server error' });
});

// Close every session (and the managed Xvfb) on shutdown so no browser or virtual
// display is orphaned.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    closeAllSessions().finally(() => process.exit(0));
  });
}

app.listen(AUTODL_PORT, () => {
  console.log(`\n==========================================`);
  console.log(`🤖 Auto-downloader listening on port ${AUTODL_PORT}`);
  console.log(`📥 SERVER_URL: ${SERVER_URL}`);
  console.log(`🌐 CORS origin: ${ALLOWED_ORIGIN}`);
  console.log(`==========================================\n`);
});
