import { describe, it, expect } from 'vitest'
import type { InFlightEntry, RunnerStatus } from '@/types'
import { headerState, nightlyPicksUp } from './runnerState'

const entry: InFlightEntry = {
  course: 'c',
  lecture: 'l',
  kind: 'lecture',
  step: 'pdf',
  startedAt: '2026-09-30T10:00:00Z',
  sleepingUntil: null,
  progress: null,
}

function status(running: boolean, inFlight: InFlightEntry[], done = 0, total = 0): RunnerStatus {
  return {
    runner: { running, done, total, lastError: null },
    inFlight,
    queue: [],
    overviewRunning: [],
    errors: {},
  }
}

describe('headerState', () => {
  it('is idle with no status and with nothing in flight', () => {
    expect(headerState(null)).toEqual({ kind: 'idle' })
    expect(headerState(status(false, []))).toEqual({ kind: 'idle' })
  })

  it('counts a manual run the queue is not draining', () => {
    expect(headerState(status(false, [entry, entry]))).toEqual({ kind: 'manual', count: 2 })
  })

  it('reports the sweep position, capped at total', () => {
    expect(headerState(status(true, [entry], 1, 3))).toEqual({
      kind: 'sweep',
      current: 2,
      total: 3,
    })
    expect(headerState(status(true, [], 3, 3))).toEqual({ kind: 'sweep', current: 3, total: 3 })
  })
})

describe('nightlyPicksUp', () => {
  it('needs the nightly switch on and auto-run above off', () => {
    expect(nightlyPicksUp(true, 'full')).toBe(true)
    expect(nightlyPicksUp(true, 'audio')).toBe(true)
    expect(nightlyPicksUp(true, 'off')).toBe(false)
    expect(nightlyPicksUp(false, 'full')).toBe(false)
  })
})
