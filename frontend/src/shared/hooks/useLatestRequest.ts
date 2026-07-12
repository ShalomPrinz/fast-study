import { useCallback, useRef } from 'react'

// Guards against stale async responses overwriting fresher ones when the same
// fetcher is triggered repeatedly (e.g. SSE notify bursts around step boundaries,
// or rapid user clicks). Only the most recently issued call's resolved value is
// returned; superseded calls resolve to undefined and should be ignored.
export function useLatestRequest() {
  const idRef = useRef(0)
  return useCallback(async <T,>(p: Promise<T>): Promise<T | undefined> => {
    const id = ++idRef.current
    const v = await p
    return id === idRef.current ? v : undefined
  }, [])
}
