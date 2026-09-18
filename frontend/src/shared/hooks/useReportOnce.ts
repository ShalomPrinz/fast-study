import { useCallback, useRef } from 'react'

// Dedupes `(key, msg)` across refreshes; `prune` rearms keys gone from `validKeys` (within `inScope`
// only), and `seed` records a pair unsent so errors predating load stay quiet.
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
