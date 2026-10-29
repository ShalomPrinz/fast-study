import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { isTourDismissed } from '@/features/tour/tourFlag'

interface TourValue {
  active: boolean
  start: () => void
  stop: () => void
}

const TourContext = createContext<TourValue | null>(null)

// Whether the guided tour is running. It starts on mount unless dismissed for good: mounted in
// `Layout`, that is every launch that reaches the app, and right after the first-run wall.
export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(() => !isTourDismissed())
  return (
    <TourContext.Provider
      value={{ active, start: () => setActive(true), stop: () => setActive(false) }}
    >
      {children}
    </TourContext.Provider>
  )
}

export function useTour(): TourValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>')
  return ctx
}
