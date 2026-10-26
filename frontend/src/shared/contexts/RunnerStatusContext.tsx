import { createContext, useContext } from 'react'
import type { RunnerStatus, InFlightEntry, Kind, RunError, RunKind } from '@/types'

// Provided by `SnapshotProvider`, which refreshes `/status` together with the tree.
interface RunnerStatusValue {
  status: RunnerStatus | null
  trigger: () => Promise<void>
  isInFlight: (course: string, lecture: string, kind: Kind) => boolean
  getInFlight: (course: string, lecture: string, kind: Kind) => InFlightEntry | null
  getError: (course: string, lecture: string, kind: Kind) => RunError | null
  getAssignmentRun: (course: string, assignment: string) => InFlightEntry | null
  getAssignmentError: (course: string, assignment: string) => RunError | null
  // Called when this window's run answered `started`: drops the lecture's previous error.
  markStarted: (course: string, lecture: string, kind: RunKind) => void
}

export type UpdateKind = 'info' | 'error'

export const RunnerStatusContext = createContext<RunnerStatusValue>({
  status: null,
  trigger: async () => {},
  isInFlight: () => false,
  getInFlight: () => null,
  getError: () => null,
  getAssignmentRun: () => null,
  getAssignmentError: () => null,
  markStarted: () => {},
})

export function useRunnerStatus() {
  return useContext(RunnerStatusContext)
}
