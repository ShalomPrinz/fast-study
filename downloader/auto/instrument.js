// Sentry init, imported first by app.js so the process-level handlers exist before anything runs.
import * as Sentry from '@sentry/node';
import { enabled, gate, options } from '@faststudy/sentry';

if (enabled()) {
  Sentry.init({
    ...options('auto'),
    // Gated so the live error-reports switch stops sending at once; never re-init, which stacks handlers.
    transport: gate(Sentry.makeNodeTransport),
    // 'strict' keeps Node's exit on an unhandled rejection; the SDK's default 'warn' would swallow it.
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'strict' })],
  });
}
