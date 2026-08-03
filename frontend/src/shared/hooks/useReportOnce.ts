import { useCallback, useRef } from 'react'

// Dedupes `(key, msg)` so a repeated status refresh doesn't re-toast the same error.
// Before: every refresh re-sends errors[key]. After: sent once; prune(validKeys) rearms the key.
// prune's `inScope` limits deletion to the caller's own keys, so other scopes aren't rearmed.
// seed(key, msg) records a pair without sending, so pre-existing errors on load are suppressed.
export function useReportOnce(send: ((msg: string) => void) | undefined) {
  const sendRef = useRef(send)
  sendRef.current = send
  const reportedRef = useRef<Map<string, Set<string>>>(new Map())

  const report = useCallback((key: string, msg: string) => {
    const msgs = reportedRef.current.get(key) ?? new Set<string>()
    if (msgs.has(msg)) return
    msgs.add(msg)
    reportedRef.current.set(key, msgs)
    sendRef.current?.(msg)
  }, [])

  const seed = useCallback((key: string, msg: string) => {
    const msgs = reportedRef.current.get(key) ?? new Set<string>()
    msgs.add(msg)
    reportedRef.current.set(key, msgs)
  }, [])

  const prune = useCallback((validKeys: Set<string>, inScope?: (key: string) => boolean) => {
    for (const k of reportedRef.current.keys()) {
      if (inScope && !inScope(k)) continue
      if (!validKeys.has(k)) reportedRef.current.delete(k)
    }
  }, [])

  return { report, seed, prune }
}

export type ReportOnce = ReturnType<typeof useReportOnce>
