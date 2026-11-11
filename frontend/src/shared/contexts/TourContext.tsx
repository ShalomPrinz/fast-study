import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { isTourSeen, markTourSeen } from '@/features/tour/tourFlag'

interface TourValue {
  active: boolean
  start: () => void
  stop: () => void
}

const TourContext = createContext<TourValue | null>(null)

// Whether the tour is showing. It starts on mount only until it has been seen once (mounted in
// `Layout`, so right after the first-run wall); `stop` marks it seen however it ended, `start` replays.
export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(() => !isTourSeen())
  const stop = () => {
    markTourSeen()
    setActive(false)
  }
  return (
    <TourContext.Provider value={{ active, start: () => setActive(true), stop }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour(): TourValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>')
  return ctx
}
