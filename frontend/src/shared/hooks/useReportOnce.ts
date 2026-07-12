import { useCallback, useRef } from 'react'

// Dedupes `(key, msg)` pairs so the same error doesn't fire twice.
// Before: every refresh re-sends the same lastError or errors[key] toast
// After:  each (key, msg) is sent once; prune(validKeys) lets it fire again if the key reappears later
// prune's optional inScope predicate limits deletion to keys it owns (e.g. one course), so a
// caller pruning its own slice can't forget another scope's keys and re-toast them on return.
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

  const prune = useCallback((validKeys: Set<string>, inScope?: (key: string) => boolean) => {
    for (const k of reportedRef.current.keys()) {
      if (inScope && !inScope(k)) continue
      if (!validKeys.has(k)) reportedRef.current.delete(k)
    }
  }, [])

  return { report, prune }
}
