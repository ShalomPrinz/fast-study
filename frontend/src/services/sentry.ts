import * as Sentry from '@sentry/electron/renderer'
import { enabled, gate, options, reporting, setReporting } from '@faststudy/sentry'
import { failureId, isUnmapped, type ServiceFailure } from '@/shared/i18n/serviceErrors'
import { runtimeBridge } from './runtime'

// The renderer SDK sends over IPC to Electron main, which scrubs and ships every event — see
// docs/SERVICES.md §sentry.ts. Browser dev has no main to send through, so nothing inits there.

/** Init the renderer SDK before the first render; a no-op without the bridge or a baked DSN. The
 *  user's switch never decides the init — it gates what is sent, live, through `setReporting`. */
export function initSentry(): void {
  const bridge = runtimeBridge()
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!bridge || !enabled(dsn)) return
  setReporting(bridge.errorReports === true)
  // The renderer SDK drops `initialScope`, so the `service=frontend` tag main keeps is set directly.
  const { initialScope, ...rest } = options('frontend', { dsn, version: bridge.version })
  Sentry.init({ ...rest, transport: gate(Sentry.makeRendererTransport) })
  Sentry.setTags({ ...initialScope.tags })
}

/** Follow the user's switch after a settings save; only an explicit yes is on. */
export function applyErrorReports(on: boolean | null): void {
  setReporting(on === true)
}

/** Report a render error the boundary caught. The event id when it was handed to main, null when
 *  nothing is sent (browser dev, a DSN-less build, the switch off) or the capture threw. */
export function captureRenderError(
  error: Error,
  { componentStack, route }: { componentStack: string; route: string },
): string | null {
  if (!isReporting()) return null
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
  return Sentry.isInitialized() && reporting()
}

const reported = new Set<string>()

/** Report a failure shown with no catalog row (no code, or an unknown one), once per distinct failure.
 *  Callers exclude connection failures. Nothing is sent when not reporting. */
export function captureUnmappedFailure(failure: ServiceFailure): void {
  if (!isUnmapped(failure) || !isReporting()) return
  const id = failureId(failure)
  if (reported.has(id)) return
  reported.add(id)
  try {
    Sentry.captureMessage(`Unmapped service error: ${failure.code ?? 'no code'}`, {
      level: 'error',
      fingerprint: ['unmapped-service-error', failure.code ?? failure.message],
      tags: { error_code: failure.code ?? 'none' },
      extra: { message: failure.message, params: failure.params ?? null },
    })
  } catch {
    // reporting must never break rendering a failure
  }
}
