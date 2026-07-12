import { useEffect, useRef, useState } from 'react'
import type { Step, TimingStats } from '@/types'
import { fetchTimingStats } from '@/services/backend'

// Async (step, size) -> TimingStats with a staleness guard: late responses
// for a (step, size) the caller has moved on from are dropped.
export function useTimingStats(step: Step | null, fileSizeBytes: number): TimingStats | null {
  const [state, setState] = useState<{ key: string; stats: TimingStats | null } | null>(null)
  const reqKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!step) {
      reqKeyRef.current = null
      setState(null)
      return
    }
    const key = `${step}:${fileSizeBytes}`
    if (reqKeyRef.current === key) return
    reqKeyRef.current = key
    setState({ key, stats: null })
    fetchTimingStats(step, fileSizeBytes)
      .then((stats) => { if (reqKeyRef.current === key) setState({ key, stats }) })
      .catch(() => { if (reqKeyRef.current === key) setState({ key, stats: { message: 'not-enough-data' } }) })
  }, [step, fileSizeBytes])

  const expectedKey = step ? `${step}:${fileSizeBytes}` : null
  return state && state.key === expectedKey ? state.stats : null
}
