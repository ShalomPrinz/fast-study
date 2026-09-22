import { useCallback, useRef } from 'react'

// Dedupes `(key, id)` across refreshes; `prune` rearms keys gone from `validKeys` (within `inScope`
// only), and `seed` records a pair unsent so errors predating load stay quiet.
//
// `id` is what identifies a report, `payload` is what reaches `send` — the two differ only where
// the report is a node (a service failure's sentence plus its isolated detail), which cannot be
// compared; a plain-string caller passes the id alone and gets it back.
export function useReportOnce<T = string>(send: ((payload: T) => void) | undefined) {
  const sendRef = useRef(send)
  sendRef.current = send
  const reportedRef = useRef<Map<string, Set<string>>>(new Map())

  const report = useCallback((key: string, id: string, payload: T = id as T) => {
    const ids = reportedRef.current.get(key) ?? new Set<string>()
    if (ids.has(id)) return
    ids.add(id)
    reportedRef.current.set(key, ids)
    sendRef.current?.(payload)
  }, [])

  const seed = useCallback((key: string, id: string) => {
    const ids = reportedRef.current.get(key) ?? new Set<string>()
    ids.add(id)
    reportedRef.current.set(key, ids)
  }, [])

  const prune = useCallback((validKeys: Set<string>, inScope?: (key: string) => boolean) => {
    for (const k of reportedRef.current.keys()) {
      if (inScope && !inScope(k)) continue
      if (!validKeys.has(k)) reportedRef.current.delete(k)
    }
  }, [])

  return { report, seed, prune }
}

export type ReportOnce = ReturnType<typeof useReportOnce<string>>
