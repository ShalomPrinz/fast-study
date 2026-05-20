import type { Step, TimingStats, Kind, FileStatus } from '../types'
import { STEP_INPUT_FILE, STEP_SET } from '../constants/pipeline'
import { useResumeStatus } from '../contexts/ResumeStatusContext'
import { useTimingStats } from './useTimingStats'

export interface RemoteInflight {
  step: Step
  startedAt: number
  timingStats: TimingStats | null
  completedFraction: number
}

interface Args {
  course: string
  lecture: string
  kind: Kind
  files: FileStatus | null
  transcribePartial: { completed: number; total: number } | null
}

// Synthesizes an inflight descriptor when the backend resume runner is processing
// the currently-open lecture. Returns null otherwise. The caller is responsible
// for deciding whether a concurrent local run preempts this.
export function useRemoteInflightState({ course, lecture, kind, files, transcribePartial }: Args): RemoteInflight | null {
  const { status } = useResumeStatus()

  const resumeMatch =
    !!status?.running &&
    !!status.current &&
    status.current.course === course &&
    status.current.lecture === lecture &&
    status.current.kind === kind &&
    STEP_SET.has(status.current.step)

  const singleAutoMatch =
    !!status?.singleAutoCurrent &&
    status.singleAutoCurrent.course === course &&
    status.singleAutoCurrent.lecture === lecture &&
    status.singleAutoCurrent.kind === kind &&
    STEP_SET.has(status.singleAutoCurrent.step)

  const matches = resumeMatch || singleAutoMatch
  const current = resumeMatch ? status!.current! : singleAutoMatch ? status!.singleAutoCurrent! : null

  const step = matches ? (current!.step as Step) : null
  const startedAtIso = matches ? current!.startedAt : null

  const inputFile = step ? STEP_INPUT_FILE[step] : null
  const fileSizeBytes = step && inputFile && files ? files[inputFile]?.size ?? 0 : 0
  const timingStats = useTimingStats(files ? step : null, fileSizeBytes)

  if (!step || !startedAtIso) return null

  const startedAtMs = Date.parse(startedAtIso)
  let completedFraction = 0
  if (
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
  }
}
