import { connectionsQuiet, runtimeBridge } from '@/services/runtime'

// Whether the "a service is down" banner shows. A module store, like `events.ts`, because the two
// triggers (the launcher's stopped push, a `ConnectionError` from any client) live outside React.
let shown = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (shown === next) return
  shown = next
  for (const l of listeners) l()
}

export function subscribeServiceDown(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const serviceDownShown = (): boolean => shown

/** A request never reached a service. Silent while the OS sleeps or just woke (`connectionsQuiet`). */
export function reportConnectionError(quiet = connectionsQuiet()): void {
  if (!quiet) set(true)
}

/** The launcher saw a service exit; that is never an expected failure, so no quiet window applies. */
export function reportServiceStopped(): void {
  set(true)
}

/** Hides the banner until the next stopped push or `ConnectionError`. */
export function dismissServiceDown(): void {
  set(false)
}

/** The Restart button exists only where the launcher can restart the services. */
export function canRestartServices(bridge = runtimeBridge()): boolean {
  return typeof bridge?.services?.restart === 'function'
}

/** Restarting kills every service, so it asks first when any pipeline run, overview generation or download is live. */
export function restartNeedsConfirm(work: {
  pipeline: boolean
  downloadJobs: boolean
  sectionRuns: boolean
}): boolean {
  return work.pipeline || work.downloadJobs || work.sectionRuns
}

runtimeBridge()?.services?.onStopped(reportServiceStopped)
