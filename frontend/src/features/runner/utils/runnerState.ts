import type { AutoRun } from '@/services/settings'
import type { RunnerStatus } from '@/types'

export type HeaderState =
  | { kind: 'sweep'; current: number; total: number }
  | { kind: 'manual'; count: number }
  | { kind: 'idle' }

// What the header says is running. `runner.running` is only the queue draining; a manual run shows up
// in `inFlight` alone, and the header must never say idle above a non-empty "Now running".
export function headerState(status: RunnerStatus | null): HeaderState {
  if (!status) return { kind: 'idle' }
  const { running, done, total } = status.runner
  // `done` counts finished lectures; the current one is 1-indexed and capped at total.
  if (running) return { kind: 'sweep', current: Math.min(done + 1, total), total }
  if (status.inFlight.length > 0) return { kind: 'manual', count: status.inFlight.length }
  return { kind: 'idle' }
}

// Whether the nightly pass will pick up unqueued lectures: it needs both its own switch and an
// auto-run ceiling above off.
export function nightlyPicksUp(nightlyRun: boolean, autoRun: AutoRun): boolean {
  return nightlyRun && autoRun !== 'off'
}

// The queue's head is next regardless, so only a later row can be moved in front of it.
export function canMoveToFront(queueIndex: number): boolean {
  return queueIndex > 0
}
