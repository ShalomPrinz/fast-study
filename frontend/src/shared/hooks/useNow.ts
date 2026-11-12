import { useState, useSyncExternalStore } from 'react'

const TICK_MS = 1000

// The app's one clock: a single timer that runs only while something is subscribed.
let tickedAt = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function tick() {
  tickedAt = Date.now()
  for (const notify of listeners) notify()
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  timer ??= setInterval(tick, TICK_MS)
  return () => {
    listeners.delete(notify)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

const lastTick = () => tickedAt

// The current clock in ms, shared by every ticking component so they all update in one commit per second.
export function useNow(): number {
  const ticked = useSyncExternalStore(subscribe, lastTick)
  // Until its first tick a component reads the clock it mounted at, not the previous tick's stale value.
  const [mountedAt] = useState(Date.now)
  return Math.max(ticked, mountedAt)
}
