import { useEffect, useRef } from 'react'
import { subscribeNotify, type Topic } from '@/services/events'

// SSE notify subscription, filtered to `topics` (all when omitted); the ref keeps `cb` fresh without re-subscribing each render.
export function useNotify(cb: (matched: Topic[]) => void, topics?: readonly Topic[]): void {
  const cbRef = useRef(cb)
  useEffect(() => {
    cbRef.current = cb
  })

  useEffect(() => {
    return subscribeNotify((matched) => cbRef.current(matched), topics)
  }, [])
}
