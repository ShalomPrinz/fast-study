// Sentry init, imported first by app.js so the process-level handlers exist before anything runs.
import * as Sentry from '@sentry/node';
import { enabled, options } from '@faststudy/sentry';

if (enabled()) {
  Sentry.init({
    ...options('auto'),
    // 'strict' keeps Node's exit on an unhandled rejection; the SDK's default 'warn' would swallow it.
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'strict' })],
  });
}
