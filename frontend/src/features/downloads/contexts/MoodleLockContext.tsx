import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { MoodleLock, MoodleLockState, WithMoodleLock } from '../utils/moodleLock'
import { createMoodleLock } from '../utils/moodleLock'

const MoodleLockContext = createContext<MoodleLock | null>(null)

// Rendered by `AuthStatusProvider`, which owns the stream. `frame` is the last pushed state, a new object
// per frame, so a repeated value still reaches the lock — a waiting call wakes on any frame.
export function MoodleLockProvider({
  frame,
  children,
}: {
  frame: { moodleBusy?: boolean } | null
  children: ReactNode
}) {
  const [lock] = useState(createMoodleLock)
  useEffect(() => {
    if (frame) lock.frame(frame.moodleBusy ?? false)
  }, [lock, frame])
  return <MoodleLockContext.Provider value={lock}>{children}</MoodleLockContext.Provider>
}

function useLock(): MoodleLock {
  const lock = useContext(MoodleLockContext)
  if (!lock) throw new Error('useMoodleLock must be used within an <AuthStatusProvider>')
  return lock
}

// Identity-stable and subscribing to nothing, so a provider or memoized row can hold it freely.
export function useWithMoodleLock(): WithMoodleLock {
  return useLock().run
}

export function useMoodleLockState(): MoodleLockState {
  const lock = useLock()
  return useSyncExternalStore(lock.subscribe, lock.getState)
}
