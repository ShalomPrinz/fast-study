import { useEffect, useRef } from 'react'
import { subscribeNotify } from '@/services/events'

// SSE notify subscription; the ref keeps `cb` fresh without re-subscribing each render.
export function useNotify(cb: () => void): void {
  const cbRef = useRef(cb)
  useEffect(() => { cbRef.current = cb })

  useEffect(() => {
    return subscribeNotify(() => cbRef.current())
  }, [])
}
