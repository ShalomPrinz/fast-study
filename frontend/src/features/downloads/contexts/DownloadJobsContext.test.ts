import { describe, it, expect } from 'vitest'
import type { DownloadJob } from '../services/downloadServer'
import { groupJobsByRef, jobsForRef } from './DownloadJobsContext'

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

describe('groupJobsByRef', () => {
  it('groups jobs into one bucket per ref', () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', ref: 'r1' }),
      job({ id: 'b', ref: 'r2' }),
      job({ id: 'c', ref: 'r1' }),
    ])
    expect(jobsForRef(byRef, 'Algo', 'r1')?.map((j) => j.id)).toEqual(['a', 'c'])
    expect(jobsForRef(byRef, 'Algo', 'r2')?.map((j) => j.id)).toEqual(['b'])
  })

  it("keeps one course's jobs out of another course's row with the same ref", () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', course: 'Algo', ref: 'r1' }),
      job({ id: 'b', course: 'Logic', ref: 'r1', status: 'error' }),
    ])
    expect(jobsForRef(byRef, 'Algo', 'r1').map((j) => j.id)).toEqual(['a'])
    expect(jobsForRef(byRef, 'Logic', 'r1').map((j) => j.id)).toEqual(['b'])
    expect(jobsForRef(byRef, 'Fresh', 'r1')).toHaveLength(0)
  })

  it('sorts a bucket by lecture, then by id', () => {
    const byRef = groupJobsByRef([
      job({ id: 'z', lecture: 'lecture 1.2' }),
      job({ id: 'b', lecture: 'lecture 1.1' }),
      job({ id: 'a', lecture: 'lecture 1.2' }),
    ])
    expect(jobsForRef(byRef, 'Algo', 'r1')?.map((j) => j.id)).toEqual(['b', 'a', 'z'])
  })

  it('excludes jobs with no ref — the extension started them, so no row owns them', () => {
    const byRef = groupJobsByRef([job({ id: 'a', ref: null }), job({ id: 'b', ref: 'r1' })])
    expect(byRef.size).toBe(1)
    expect(jobsForRef(byRef, 'Algo', 'r1')?.map((j) => j.id)).toEqual(['b'])
  })

  it('maps a job to its display atom, collapsing queued into running', () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', status: 'queued', lecture: 'L1', course: 'Algo', kind: 'recitation' }),
      job({ id: 'b', status: 'done', ref: 'r2' }),
      job({ id: 'c', status: 'error', ref: 'r3' }),
    ])
    expect(jobsForRef(byRef, 'Algo', 'r1')?.[0]).toEqual({
      id: 'a',
      title: 'L1',
      ref: 'r1',
      course: 'Algo',
      kind: 'recitation',
      status: 'running',
      startedAt: null,
      expectedBytes: null,
      operation: null,
    })
    expect(jobsForRef(byRef, 'Algo', 'r2')?.[0].status).toBe('done')
    expect(jobsForRef(byRef, 'Algo', 'r3')?.[0].status).toBe('error')
  })
})

describe('jobsForRef', () => {
  // useSyncExternalStore compares snapshots by identity, so a per-call `[]` would loop forever.
  it('returns one shared empty array for every miss, across rebuilds', () => {
    const first = groupJobsByRef([job({ id: 'a', ref: 'r1' })])
    const second = groupJobsByRef([job({ id: 'b', ref: 'r2' })])
    expect(jobsForRef(first, 'Algo', 'missing')).toBe(jobsForRef(first, 'Algo', 'other'))
    expect(jobsForRef(first, 'Algo', 'missing')).toBe(jobsForRef(second, 'Algo', 'r1'))
    expect(jobsForRef(first, 'Algo', 'missing')).toHaveLength(0)
  })

  it('returns the same bucket on every hit', () => {
    const byRef = groupJobsByRef([job({ id: 'a', ref: 'r1' })])
    expect(jobsForRef(byRef, 'Algo', 'r1')).toBe(jobsForRef(byRef, 'Algo', 'r1'))
    expect(jobsForRef(byRef, 'Algo', 'r1')).toHaveLength(1)
  })
})
