import { describe, it, expect } from 'vitest'
import type { DownloadJob } from '../services/downloadServer'
import {
  coursesWithActiveJobs,
  groupJobsByRef,
  indexJobsById,
  jobsForRef,
  jobsForTarget,
  rowStatus,
} from './DownloadJobsContext'

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

describe('jobsForTarget', () => {
  const bucket = jobsForRef(
    groupJobsByRef([
      job({ id: 'a', lecture: 'שיעור 3', status: 'done' }),
      job({ id: 'b', lecture: 'שיעור 4.1' }),
      job({ id: 'c', lecture: 'שיעור 4.2' }),
    ]),
    'Algo',
    'r1',
  )

  // A row renamed away from a finished download must not read "Downloaded ✓" for the new name.
  it('drops a job filed under another name', () => {
    const jobs = jobsForTarget(bucket, 'שיעור 33', 'lecture')
    expect(jobs).toHaveLength(0)
    expect(rowStatus(jobs)).toBeNull()
  })

  it("keeps the name's own job and its zoom halves", () => {
    expect(jobsForTarget(bucket, 'שיעור 3', 'lecture').map((j) => j.id)).toEqual(['a'])
    expect(jobsForTarget(bucket, 'שיעור 4', 'lecture').map((j) => j.id)).toEqual(['b', 'c'])
  })

  it('drops a job of the other kind', () => {
    expect(jobsForTarget(bucket, 'שיעור 3', 'recitation')).toHaveLength(0)
  })

  // Shared identities keep a row's snapshot stable; a miss is the frozen empty array.
  it('returns the bucket itself when nothing is dropped, and the shared empty on a miss', () => {
    const one = jobsForRef(groupJobsByRef([job({ id: 'a' })]), 'Algo', 'r1')
    expect(jobsForTarget(one, 'lecture 1', 'lecture')).toBe(one)
    expect(jobsForTarget(bucket, 'x', 'lecture')).toBe(jobsForRef(new Map(), 'Algo', 'r1'))
  })
})

describe('coursesWithActiveJobs', () => {
  it('names every course a queued or running job writes into, extension jobs included', () => {
    const active = coursesWithActiveJobs([
      job({ id: 'a', course: 'Algo', status: 'running' }),
      job({ id: 'b', course: 'Logic', status: 'queued', ref: null }),
      job({ id: 'c', course: 'Done', status: 'done' }),
      job({ id: 'd', course: 'Failed', status: 'error' }),
    ])
    expect([...active].sort()).toEqual(['Algo', 'Logic'])
  })
})

describe('indexJobsById', () => {
  it('keeps the jobs no discovery row owns, which grouping by ref drops', () => {
    const snapshot = [job({ id: 'a', ref: null }), job({ id: 'b', ref: 'r1' })]
    const byId = indexJobsById(snapshot)
    expect(byId.get('a')?.ref).toBeNull()
    expect(byId.get('b')?.ref).toBe('r1')
    expect(groupJobsByRef(snapshot).size).toBe(1)
  })
})
