import type { Step, StepResult, TimingStats, Kind, ResumeStatus } from '../types'
import { createClient, kindQuery, lectureBase } from './http'

const backend = createClient(import.meta.env.VITE_API_URL ?? 'http://localhost:8000')

export async function runStep(course: string, lecture: string, step: Step, kind?: Kind): Promise<StepResult> {
  return backend.post<StepResult>(`${lectureBase(course, lecture)}/run/${step}${kindQuery(kind)}`)
}

export async function fetchTimingStats(operation: string, fileSizeBytes: number): Promise<TimingStats> {
  return backend.get<TimingStats>(`/timing/${operation}?file_size_bytes=${fileSizeBytes}`)
}

type CurrentStatus = {
  course: string
  lecture: string
  kind: Kind
  step: string
  started_at: string
}

type ResumeStatusRaw = {
  running: boolean
  total: number
  done: number
  current: CurrentStatus | null
  single_auto_current: CurrentStatus | null
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
    singleAutoCurrent: raw.single_auto_current
      ? {
          course: raw.single_auto_current.course,
          lecture: raw.single_auto_current.lecture,
          kind: raw.single_auto_current.kind,
          step: raw.single_auto_current.step,
          startedAt: raw.single_auto_current.started_at,
        }
      : null,
    sleepingUntil: raw.sleeping_until,
    lastError: raw.last_error,
  }
}

export async function resumeAll(): Promise<ResumeStatus | 'empty_queue'> {
  const raw = await backend.post<ResumeStatusRaw | { status: 'empty_queue' }>('/resume-all')
  if ('status' in raw && raw.status === 'empty_queue') return 'empty_queue'
  return normalizeResume(raw as ResumeStatusRaw)
}

export async function fetchResumeStatus(): Promise<ResumeStatus> {
  const raw = await backend.get<ResumeStatusRaw>('/resume-status')
  return normalizeResume(raw)
}
