import { useCallback, useRef } from 'react'

// Drops stale responses when one fetcher is re-triggered (SSE notify bursts, rapid clicks):
// only the newest call resolves to a value, superseded ones resolve to undefined.
export function useLatestRequest() {
  const idRef = useRef(0)
  return useCallback(async <T,>(p: Promise<T>): Promise<T | undefined> => {
    const id = ++idRef.current
    const v = await p
    return id === idRef.current ? v : undefined
  }, [])
}
