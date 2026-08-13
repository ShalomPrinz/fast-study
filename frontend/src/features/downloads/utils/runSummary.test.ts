import { describe, it, expect } from 'vitest'
import type { DownloadJob } from '../services/downloadServer'
import { groupJobsByRef } from '../contexts/DownloadJobsContext'
import type { Tally } from './runSummary'
import { runSettled, summarize } from './runSummary'

function job(over: Partial<DownloadJob> & Pick<DownloadJob, 'id'>): DownloadJob {
  return {
    status: 'running',
    course: 'Algo',
    lecture: 'lecture 1',
    kind: 'lecture',
    tool: null,
    operation: null,
    ref: 'r1',
    expectedBytes: null,
    startedAt: null,
    message: null,
    ...over,
  }
}

function tally(over: Partial<Tally> = {}): Tally {
  return { started: [], failed: 0, skipped: 0, unsupported: 0, ...over }
}

describe('summarize', () => {
  it('counts a started row as downloaded only when all its jobs are done', () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', ref: 'r1', status: 'done' }),
      job({ id: 'b', ref: 'r2', status: 'done' }),
      job({ id: 'c', ref: 'r2', status: 'error' }),
    ])
    const started = [byRef.get('r1') ?? [], byRef.get('r2') ?? []]
    expect(summarize(tally({ started: ['r1', 'r2'] }), started)).toBe('1 downloaded, 1 failed')
  })

  it('omits every zero part and keeps the tallied ones', () => {
    expect(summarize(tally({ skipped: 2, unsupported: 1 }), [])).toBe(
      '0 downloaded, 1 unsupported, 2 already there',
    )
  })
})

describe('runSettled', () => {
  it('is settled when a run started nothing', () => {
    expect(runSettled([], groupJobsByRef([]))).toBe(true)
  })

  it('is unsettled while a ref still has a running job', () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', ref: 'r1', status: 'done' }),
      job({ id: 'b', ref: 'r2' }),
    ])
    expect(runSettled(['r1', 'r2'], byRef)).toBe(false)
  })

  it('is unsettled while a started ref has no jobs yet', () => {
    const byRef = groupJobsByRef([job({ id: 'a', ref: 'r1', status: 'done' })])
    expect(runSettled(['r1', 'r2'], byRef)).toBe(false)
  })

  it('is settled once every started ref is terminal', () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', ref: 'r1', status: 'done' }),
      job({ id: 'b', ref: 'r2', status: 'error' }),
    ])
    expect(runSettled(['r1', 'r2'], byRef)).toBe(true)
  })
})
