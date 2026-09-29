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

// Every value newer than the last one returned settles; only one an even newer call already
// returned is dropped. For refetches of one resource, where a latest-only gate starves under a
// steady trigger stream — each answer is overtaken by the next request before it lands.
export function createNewestGate() {
  let issued = 0
  let returned = 0
  return async <T>(p: Promise<T>): Promise<T | undefined> => {
    const id = ++issued
    try {
      const v = await p
      if (id < returned) return undefined
      returned = id
      return v
    } catch (err) {
      if (id === issued) throw err
      return undefined
    }
  }
}

// Drops stale responses when one fetcher is re-triggered (SSE notify bursts, rapid clicks). The gate
// is created once, so its identity is stable and callers can list it in effect deps.
export function useLatestRequest() {
  return useState(createLatestGate)[0]
}

export function useNewestRequest() {
  return useState(createNewestGate)[0]
}
