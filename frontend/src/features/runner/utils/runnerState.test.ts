import { describe, it, expect } from 'vitest'
import type { InFlightEntry, RunError, RunnerStatus } from '@/types'
import { canMoveToFront, headerState, waitingRetries } from './runnerState'

const entry: InFlightEntry = {
  course: 'c',
  lecture: 'l',
  kind: 'lecture',
  step: 'pdf',
  startedAt: '2026-09-30T10:00:00Z',
}

function status(running: boolean, inFlight: InFlightEntry[], done = 0, total = 0): RunnerStatus {
  return {
    runner: { running, done, total, lastError: null },
    inFlight,
    queue: [],
    overviewRunning: [],
    notices: [],
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

  it('counts lecture runs only, so an assignment run is running but not a lecture', () => {
    const assignment: InFlightEntry = { ...entry, kind: 'assignment' }
    expect(headerState(status(false, [assignment]))).toEqual({ kind: 'manual', count: 0 })
    expect(headerState(status(false, [entry, assignment]))).toEqual({ kind: 'manual', count: 1 })
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

describe('canMoveToFront', () => {
  it('leaves the head of the queue inert and lets every later row move', () => {
    expect(canMoveToFront(0)).toBe(false)
    expect(canMoveToFront(1)).toBe(true)
    expect(canMoveToFront(5)).toBe(true)
  })
})

describe('waitingRetries', () => {
  const err = (retry: RunError['retry']): RunError => ({
    step: 'summarize',
    message: '',
    code: 'gemini_overloaded',
    params: {},
    provider: null,
    blocked: false,
    retry,
  })
  const at = (iso: string) => ({ attempt: 1, of: 3, at: iso })

  it('lists lectures and recitations that wait, soonest first', () => {
    const out = waitingRetries({
      'C||late||lecture': err(at('2026-10-29T12:20:00Z')),
      'C||soon||recitation': err(at('2026-10-29T12:10:00Z')),
    })
    expect(out.map((w) => [w.lecture, w.kind])).toEqual([
      ['soon', 'recitation'],
      ['late', 'lecture'],
    ])
  })

  it('skips plain errors, assignments and keys that are not lectures', () => {
    expect(
      waitingRetries({
        'C||plain||lecture': err(null),
        'C||hw||assignment': err(at('2026-10-29T12:10:00Z')),
        'runner-crash': err(at('2026-10-29T12:10:00Z')),
      }),
    ).toEqual([])
  })
})
