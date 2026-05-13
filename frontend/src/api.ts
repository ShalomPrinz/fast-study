import type { Step, StepResult, TimingStats, Kind } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

function httpError(res: Response): Error {
  return new Error(`${res.status} ${res.statusText}`)
}

function kindQuery(kind: Kind | undefined): string {
  return kind === 'recitation' ? '?kind=recitation' : ''
}

export async function runStep(course: string, lecture: string, step: Step, kind?: Kind): Promise<StepResult> {
  const res = await fetch(
    `${API_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/run/${step}${kindQuery(kind)}`,
    { method: 'POST' },
  )
  if (!res.ok) throw httpError(res)
  return res.json()
}

export async function fetchTimingStats(operation: string, fileSizeBytes: number): Promise<TimingStats> {
  const res = await fetch(`${API_URL}/timing/${operation}?file_size_bytes=${fileSizeBytes}`)
  if (!res.ok) throw httpError(res)
  return res.json()
}
