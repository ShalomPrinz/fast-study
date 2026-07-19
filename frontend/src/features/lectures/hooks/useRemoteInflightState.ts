import type { Step, TimingStats, Kind, FileStatus } from '@/types'
import { STEP_INPUT_FILE, STEP_SET } from '@/features/lectures/constants/pipeline'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useTimingStats } from './useTimingStats'

export interface RemoteInflight {
  step: Step
  startedAt: number
  timingStats: TimingStats | null
  completedFraction: number
  sleepingUntil: string | null
  progress: { completed: number; total: number } | null
}

interface Args {
  course: string
  lecture: string
  kind: Kind
  files: FileStatus | null
  transcribePartial: { completed: number; total: number } | null
}

// Render descriptor for this lecture's in_flight entry; null when it isn't in flight.
export function useRemoteInflightState({ course, lecture, kind, files, transcribePartial }: Args): RemoteInflight | null {
  const { getInFlight } = useRunnerStatus()
  const entry = getInFlight(course, lecture, kind)
  const step = entry && STEP_SET.has(entry.step) ? (entry.step as Step) : null

  // The estimate keys on the step's *input* file size.
  const inputFile = step ? STEP_INPUT_FILE[step] : null
  const fileSizeBytes = step && inputFile && files ? files[inputFile]?.size ?? 0 : 0
  const timingStats = useTimingStats(files ? step : null, fileSizeBytes)

  if (!step || !entry) return null

  const startedAtMs = Date.parse(entry.startedAt)

  let completedFraction = 0
  if (entry.progress && entry.progress.total > 0) {
    completedFraction = entry.progress.completed / entry.progress.total
  } else if (
    step === 'transcribe' &&
    files?.['transcript.partial.txt'].exists &&
    transcribePartial &&
    transcribePartial.total > 0
  ) {
    completedFraction = transcribePartial.completed / transcribePartial.total
  }

  return {
    step,
    startedAt: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    timingStats,
    completedFraction,
    sleepingUntil: entry.sleepingUntil,
    progress: entry.progress,
  }
}
