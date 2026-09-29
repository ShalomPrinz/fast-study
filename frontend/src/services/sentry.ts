import * as Sentry from '@sentry/electron/renderer'
import { enabled, options } from '@faststudy/sentry'
import { runtimeBridge } from './runtime'

// The renderer SDK sends over IPC to Electron main, which scrubs and ships every event — see
// docs/SERVICES.md §sentry.ts. Browser dev has no main to send through, so nothing inits there.

/** Init the renderer SDK before the first render; a no-op without the bridge or a baked DSN. */
export function initSentry(): void {
  const bridge = runtimeBridge()
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!bridge || !enabled(dsn)) return
  // The renderer SDK drops `initialScope`, so the `service=frontend` tag main keeps is set directly.
  const { initialScope, ...rest } = options('frontend', { dsn, version: bridge.version })
  Sentry.init(rest)
  Sentry.setTags({ ...initialScope.tags })
}

/** Report a render error the boundary caught. The event id when it was handed to main, null when
 *  Sentry is off (browser dev, a DSN-less build) or the capture threw. */
export function captureRenderError(
  error: Error,
  { componentStack, route }: { componentStack: string; route: string },
): string | null {
  if (!Sentry.isInitialized()) return null
  try {
    return Sentry.captureException(error, {
      contexts: { react: { componentStack } },
      extra: { route },
    })
  } catch {
    return null
  }
}

/** Whether a caught error is reported at all; false means the fallback says nothing about it. */
export function isReporting(): boolean {
  return Sentry.isInitialized()
}
