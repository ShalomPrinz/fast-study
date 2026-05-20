import type { Step, StepResult, TimingStats, Kind, ResumeStatus } from '../types'
import { createClient, kindQuery, lectureBase } from './http'

const backend = createClient(import.meta.env.VITE_API_URL ?? 'http://localhost:8000')

export async function runStep(course: string, lecture: string, step: Step, kind?: Kind): Promise<StepResult> {
  return backend.post<StepResult>(`${lectureBase(course, lecture)}/run/${step}${kindQuery(kind)}`)
}

export async function fetchTimingStats(operation: string, fileSizeBytes: number): Promise<TimingStats> {
  return backend.get<TimingStats>(`/timing/${operation}?file_size_bytes=${fileSizeBytes}`)
}

type ResumeStatusRaw = {
  running: boolean
  total: number
  done: number
  current: { course: string; lecture: string; kind: Kind; step: string; started_at: string } | null
  sleeping_until: string | null
  last_error: string | null
}

function normalizeResume(raw: ResumeStatusRaw): ResumeStatus {
  return {
    running: raw.running,
    total: raw.total,
    done: raw.done,
    current: raw.current
      ? {
          course: raw.current.course,
          lecture: raw.current.lecture,
          kind: raw.current.kind,
          step: raw.current.step,
          startedAt: raw.current.started_at,
        }
      : null,
    sleepingUntil: raw.sleeping_until,
    lastError: raw.last_error,
  }
}

export async function resumeAll(): Promise<ResumeStatus> {
  const raw = await backend.post<ResumeStatusRaw>('/resume-all')
  return normalizeResume(raw)
}

export async function fetchResumeStatus(): Promise<ResumeStatus> {
  const raw = await backend.get<ResumeStatusRaw>('/resume-status')
  return normalizeResume(raw)
}
