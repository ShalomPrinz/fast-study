import { useState } from 'react'

// Only the newest call through one gate settles with its value or rejection; superseded ones resolve to undefined.
export function createLatestGate() {
  let latest = 0
  return async <T>(p: Promise<T>): Promise<T | undefined> => {
    const id = ++latest
    try {
      const v = await p
      return id === latest ? v : undefined
    } catch (err) {
      if (id === latest) throw err
      return undefined
    }
  }
}

// Drops stale responses when one fetcher is re-triggered (SSE notify bursts, rapid clicks). The gate
// is created once, so its identity is stable and callers can list it in effect deps.
export function useLatestRequest() {
  return useState(createLatestGate)[0]
}
