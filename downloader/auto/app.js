import express from 'express';
import cors from 'cors';
import { ALLOWED_ORIGINS, AUTODL_PORT } from './src/lib/config.js';
import { UnsupportedError } from './src/lib/errors.js';
import { serve, requireSecret } from '@faststudy/runtime';
import { closeAllSessions } from './src/browser/browserSession.js';
import {
  sendUnsupported,
  handleAuthStatus,
  handleAuthConnect,
  handleAuthComplete,
  handleList,
  handleListExpand,
  handleResolve,
  handleZoomPasscode,
  handleClose,
} from './src/http/server.js';

const app = express();
// cors handles the OPTIONS preflight for the allowed origins; no manual short-circuit.
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'OPTIONS'],
    // A pinned allowedHeaders list is exhaustive: without X-FastStudy-Secret named here the
    // preflight strips it and every call fails as a CORS error rather than an auth one.
    allowedHeaders: ['Content-Type', 'X-FastStudy-Secret'],
  }),
);
// After cors, which answers the preflight itself, so no OPTIONS ever reaches the guard.
app.use(requireSecret);
app.use(express.json()); // empty body → req.body = {} (matches the old JSON.parse(body || '{}'))

// Liveness only: what the launcher waits on before opening the window.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/auth/status', handleAuthStatus);
app.post('/auth/connect', handleAuthConnect);
app.post('/auth/complete', handleAuthComplete);
app.post('/list', handleList);
app.post('/list/expand', handleListExpand);
app.post('/resolve', handleResolve);
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

serve(app, AUTODL_PORT, (port) => {
  console.log(`\n==========================================`);
  console.log(`🤖 Auto-downloader listening on port ${port}`);
  console.log(`🌐 CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`==========================================\n`);
});
