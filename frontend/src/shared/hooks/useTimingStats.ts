import { useEffect, useRef, useState } from 'react'
import type { TimingOperation, TimingStats } from '@/types'
import { fetchTimingStats } from '@/services/backend'

// (operation, size) -> TimingStats, dropping responses for a key the caller has moved on from.
export function useTimingStats(
  operation: TimingOperation | null,
  fileSizeBytes: number,
): TimingStats | null {
  const [state, setState] = useState<{ key: string; stats: TimingStats | null } | null>(null)
  const reqKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!operation) {
      reqKeyRef.current = null
      setState(null)
      return
    }
    const key = `${operation}:${fileSizeBytes}`
    if (reqKeyRef.current === key) return
    reqKeyRef.current = key
    setState({ key, stats: null })
    fetchTimingStats(operation, fileSizeBytes)
      .then((stats) => {
        if (reqKeyRef.current === key) setState({ key, stats })
      })
      .catch(() => {
        if (reqKeyRef.current === key) setState({ key, stats: { message: 'not-enough-data' } })
      })
  }, [operation, fileSizeBytes])

  const expectedKey = operation ? `${operation}:${fileSizeBytes}` : null
  return state && state.key === expectedKey ? state.stats : null
}
