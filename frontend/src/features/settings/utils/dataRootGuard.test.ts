import { describe, it, expect } from 'vitest'
import type { RunnerStatus } from '@/types'
import { runsAtRisk } from './dataRootGuard'

function status(running: boolean, inFlight: { course: string; lecture: string }[]): RunnerStatus {
  return {
    runner: { running, total: 0, done: 0, lastError: null },
    inFlight,
    queue: [],
    errors: {},
  } as unknown as RunnerStatus
}

const ENTRY = { course: 'Algebra', lecture: 'Lecture 3' }

describe('runsAtRisk', () => {
  it('ignores a patch that leaves the data root alone, even mid-run', () => {
    expect(runsAtRisk({ geminiModel: 'm' }, status(true, [ENTRY]))).toBeNull()
  })

  it('has nothing to warn about while the runner is idle and nothing is in flight', () => {
    expect(runsAtRisk({ dataRoot: '/new' }, status(false, []))).toBeNull()
  })

  it('has nothing to warn about with no status yet', () => {
    expect(runsAtRisk({ dataRoot: '/new' }, null)).toBeNull()
  })

  it('still warns a sweeping runner with nothing in flight yet', () => {
    expect(runsAtRisk({ dataRoot: '/new' }, status(true, []))).toEqual([])
  })

  it('names each in-flight run', () => {
    expect(
      runsAtRisk(
        { dataRoot: '/new' },
        status(false, [ENTRY, { course: 'Physics', lecture: 'Recitation 1' }]),
      ),
    ).toEqual(['Algebra / Lecture 3', 'Physics / Recitation 1'])
  })
})
