// Sentry init, imported first by index.js so the process-level handlers exist before anything runs.
import * as Sentry from '@sentry/node';
import { enabled, options } from '@faststudy/sentry';

if (enabled()) {
  Sentry.init({
    ...options('server'),
    // 'strict' keeps Node's exit on an unhandled rejection; the SDK's default 'warn' would swallow it.
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'strict' })],
  });
}
