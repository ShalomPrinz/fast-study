import { createContext, useContext } from 'react'
import type { RunnerStatus, InFlightEntry, Kind, RunError } from '@/types'

// Provided by `SnapshotProvider`, which refreshes `/status` together with the tree.
interface RunnerStatusValue {
  status: RunnerStatus | null
  trigger: () => Promise<void>
  isInFlight: (course: string, lecture: string, kind: Kind) => boolean
  getInFlight: (course: string, lecture: string, kind: Kind) => InFlightEntry | null
  getError: (course: string, lecture: string, kind: Kind) => RunError | null
}

export type UpdateKind = 'info' | 'error'

export const RunnerStatusContext = createContext<RunnerStatusValue>({
  status: null,
  trigger: async () => {},
  isInFlight: () => false,
  getInFlight: () => null,
  getError: () => null,
})

export function useRunnerStatus() {
  return useContext(RunnerStatusContext)
}
