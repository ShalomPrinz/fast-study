import type { Step, RunInitResult, TimingStats, Kind, RunnerStatus } from '../types'
import { createClient, kindQuery, lectureBase } from './http'

const backend = createClient(import.meta.env.VITE_API_URL ?? 'http://localhost:8000')

export async function runStep(course: string, lecture: string, step: Step, kind?: Kind): Promise<RunInitResult> {
  return backend.post<RunInitResult>(`${lectureBase(course, lecture)}/run/${step}${kindQuery(kind)}`)
}

export async function runPipeline(course: string, lecture: string, kind?: Kind): Promise<RunInitResult> {
  return backend.post<RunInitResult>(`${lectureBase(course, lecture)}/run/pipeline${kindQuery(kind)}`)
}

export async function fetchTimingStats(operation: string, fileSizeBytes: number): Promise<TimingStats> {
  return backend.get<TimingStats>(`/timing/${operation}?file_size_bytes=${fileSizeBytes}`)
}

function normalizeRunner(raw: any): RunnerStatus {
  return {
    runner: {
      running: raw.runner.running,
      total: raw.runner.total,
      done: raw.runner.done,
      lastError: raw.runner.last_error,
    },
    inFlight: (raw.in_flight ?? []).map((e: any) => ({
      course: e.course,
      lecture: e.lecture,
      kind: e.kind,
      step: e.step,
      startedAt: e.started_at,
      sleepingUntil: e.sleeping_until,
      progress: e.progress,
    })),
    errors: raw.errors ?? {},
  }
}

export async function runAll(): Promise<RunnerStatus | 'empty_queue'> {
  const raw = await backend.post<any>('/run-all')
  if (raw.status === 'empty_queue') return 'empty_queue'
  return normalizeRunner(raw)
}

export async function fetchRunnerStatus(): Promise<RunnerStatus> {
  const raw = await backend.get<any>('/status')
  return normalizeRunner(raw)
}
