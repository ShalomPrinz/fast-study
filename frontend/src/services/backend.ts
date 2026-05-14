import type { Step, StepResult, TimingStats, Kind } from '../types'
import { createClient, kindQuery, lectureBase } from './http'

const backend = createClient(import.meta.env.VITE_API_URL ?? 'http://localhost:8000')

export async function runStep(course: string, lecture: string, step: Step, kind?: Kind): Promise<StepResult> {
  return backend.post<StepResult>(`${lectureBase(course, lecture)}/run/${step}${kindQuery(kind)}`)
}

export async function fetchTimingStats(operation: string, fileSizeBytes: number): Promise<TimingStats> {
  return backend.get<TimingStats>(`/timing/${operation}?file_size_bytes=${fileSizeBytes}`)
}
