import { useEffect, useRef } from 'react'
import { subscribeNotify } from '../services/events'

// Subscribes to SSE notify events via the shared singleton in services/events.ts.
// The cbRef keeps the callback fresh without causing a re-subscribe on each render.
export function useNotify(cb: () => void): void {
  const cbRef = useRef(cb)
  useEffect(() => { cbRef.current = cb })

  useEffect(() => {
    return subscribeNotify(() => cbRef.current())
  }, [])
}
