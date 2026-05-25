import type { Step, TimingStats, Kind, FileStatus } from '../types'
import { STEP_INPUT_FILE, STEP_SET } from '../constants/pipeline'
import { useRunnerStatus } from '../contexts/RunnerStatusContext'
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

// Synthesizes an inflight descriptor from the in_flight entry for this lecture.
// Returns null when this lecture is not in-flight (including when still running
export function useRemoteInflightState({ course, lecture, kind, files, transcribePartial }: Args): RemoteInflight | null {
  // Derive entry & step from runner status context
  const { getInFlight } = useRunnerStatus()
  const entry = getInFlight(course, lecture, kind)
  const step = entry && STEP_SET.has(entry.step) ? (entry.step as Step) : null

  // Derive timing stats using the step + input file size
  const inputFile = step ? STEP_INPUT_FILE[step] : null
  const fileSizeBytes = step && inputFile && files ? files[inputFile]?.size ?? 0 : 0
  const timingStats = useTimingStats(files ? step : null, fileSizeBytes)

  // No valid step or entry -> return null to indicate no inflight state
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
