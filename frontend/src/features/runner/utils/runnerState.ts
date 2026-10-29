import type { InFlightEntry, Kind, RetryInfo, RunError, RunnerStatus } from '@/types'
import { parseInFlightKey } from '@/shared/utils/inFlightKey'

// An in-flight entry that is a lecture or recitation, as the lecture-only helpers need it.
export type LectureRun = InFlightEntry & { kind: Kind }
export const isLectureRun = (e: InFlightEntry): e is LectureRun => e.kind !== 'assignment'

// A lecture or recitation whose failed Gemini step waits on an automatic retry: out of the runner's
// queue and in-flight lists, so the page reads it from the error record.
export interface WaitingRetry {
  course: string
  lecture: string
  kind: Kind
  retry: RetryInfo
}

/** The lectures waiting on an auto retry, soonest first; assignments show it on their own page. */
export function waitingRetries(errors: Record<string, RunError>): WaitingRetry[] {
  const out: WaitingRetry[] = []
  for (const [key, error] of Object.entries(errors)) {
    const id = parseInFlightKey(key)
    if (!id || id.kind === 'assignment' || !error.retry) continue
    out.push({ course: id.course, lecture: id.lecture, kind: id.kind, retry: error.retry })
  }
  return out.sort((a, b) => Date.parse(a.retry.at) - Date.parse(b.retry.at))
}

export type HeaderState =
  | { kind: 'sweep'; current: number; total: number }
  | { kind: 'manual'; count: number }
  | { kind: 'idle' }

// What the header says is running; `manual.count` counts lecture runs only, so it is 0 while only an assignment runs. `runner.running` is only the queue draining; a manual run shows up
// in `inFlight` alone, and the header must never say idle above a non-empty "Now running".
export function headerState(status: RunnerStatus | null): HeaderState {
  if (!status) return { kind: 'idle' }
  const { running, done, total } = status.runner
  // `done` counts finished lectures; the current one is 1-indexed and capped at total.
  if (running) return { kind: 'sweep', current: Math.min(done + 1, total), total }
  if (status.inFlight.length > 0)
    return { kind: 'manual', count: status.inFlight.filter(isLectureRun).length }
  return { kind: 'idle' }
}

// The queue's head is next regardless, so only a later row can be moved in front of it.
export function canMoveToFront(queueIndex: number): boolean {
  return queueIndex > 0
}
