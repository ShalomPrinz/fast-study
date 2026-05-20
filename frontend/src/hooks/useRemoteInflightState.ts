import { useEffect, useRef, useState } from 'react'
import type { Step, TimingStats, Kind, FileStatus } from '../types'
import { fetchTimingStats } from '../services/backend'
import { STEP_INPUT_FILE, STEP_SET } from '../constants/pipeline'
import { useResumeStatus } from './useResumeStatus'

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

  const matches =
    !!status?.running &&
    !!status.current &&
    status.current.course === course &&
    status.current.lecture === lecture &&
    status.current.kind === kind &&
    STEP_SET.has(status.current.step)

  const step = matches ? (status!.current!.step as Step) : null
  const startedAtIso = matches ? status!.current!.startedAt : null

  const [timing, setTiming] = useState<{ key: string; stats: TimingStats | null } | null>(null)
  const reqKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!step || !files) {
      reqKeyRef.current = null
      setTiming(null)
      return
    }
    const inputFile = STEP_INPUT_FILE[step]
    const fileSizeBytes = inputFile ? files[inputFile]?.size ?? 0 : 0
    const key = `${step}:${fileSizeBytes}`
    if (reqKeyRef.current === key) return
    reqKeyRef.current = key
    setTiming({ key, stats: null })
    fetchTimingStats(step, fileSizeBytes)
      .then((stats) => { if (reqKeyRef.current === key) setTiming({ key, stats }) })
      .catch(() => { if (reqKeyRef.current === key) setTiming({ key, stats: { message: 'not-enough-data' } }) })
  }, [step, files])

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

  const inputFile = STEP_INPUT_FILE[step]
  const expectedKey = `${step}:${inputFile ? files?.[inputFile]?.size ?? 0 : 0}`

  return {
    step,
    startedAt: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    timingStats: timing && timing.key === expectedKey ? timing.stats : null,
    completedFraction,
  }
}
