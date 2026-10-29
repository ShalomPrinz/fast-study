import { describe, it, expect } from 'vitest'
import type { DownloadJob, FolderJob, WireJob } from '../services/downloadServer'
import { splitJobs } from '../services/downloadServer'
import {
  coursesWithActiveJobs,
  failedJobLabel,
  groupJobsByCourse,
  groupJobsByRef,
  indexJobsById,
  jobState,
  jobsForCourse,
  jobsForRef,
  jobsForTarget,
  reconcileVanished,
  reconcileVanishedFolder,
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

describe('rowStatus', () => {
  const progress = (over: Partial<DownloadJob> & Pick<DownloadJob, 'id'>) => ({
    ...jobState(job(over)),
    ref: 'r1',
  })

  it('passes a cancelled job through as cancelled, not as an error or still running', () => {
    expect(jobState(job({ id: 'a', status: 'cancelled' })).status).toBe('cancelled')
    expect(rowStatus([progress({ id: 'a', status: 'cancelled' })])).toBe('cancelled')
  })

  it('lets a running clip win, then a failed one, over a cancelled one', () => {
    const cancelled = progress({ id: 'a', lecture: 'l.1', status: 'cancelled' })
    expect(rowStatus([cancelled, progress({ id: 'b', lecture: 'l.2' })])).toBe('running')
    expect(rowStatus([cancelled, progress({ id: 'b', status: 'error' })])).toBe('error')
    expect(rowStatus([cancelled, progress({ id: 'b', status: 'done' })])).toBe('cancelled')
  })
})

describe('coursesWithActiveJobs', () => {
  it('names every course a queued or running job writes into, extension jobs included', () => {
    const active = coursesWithActiveJobs([
      job({ id: 'a', course: 'Algo', status: 'running' }),
      job({ id: 'b', course: 'Logic', status: 'queued', ref: null }),
      job({ id: 'c', course: 'Done', status: 'done' }),
      job({ id: 'd', course: 'Failed', status: 'error' }),
      job({ id: 'e', course: 'Cancelled', status: 'cancelled' }),
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

describe('reconcileVanished', () => {
  const empty = { active: new Map(), vanished: new Map() }

  it('turns a running job that left the snapshot into a codeless error, and keeps it', () => {
    const a = job({ id: 'a' })
    const first = reconcileVanished(empty, [a])
    expect(first.jobs).toEqual([a])
    const second = reconcileVanished(first, [])
    expect(second.jobs).toMatchObject([{ id: 'a', status: 'error', message: null }])
    expect(reconcileVanished(second, []).jobs.map((j) => j.status)).toEqual(['error'])
  })

  it('does not flag a job that finished normally or an error that was already there', () => {
    const first = reconcileVanished(empty, [job({ id: 'a' }), job({ id: 'b', status: 'error' })])
    const second = reconcileVanished(first, [job({ id: 'a', status: 'done' })])
    expect(second.jobs.map((j) => j.status)).toEqual(['done'])
  })

  it('never turns a cancelled job into an error, whether it stays or leaves', () => {
    const first = reconcileVanished(empty, [job({ id: 'a' })], 'b1')
    const cancelled = reconcileVanished(first, [job({ id: 'a', status: 'cancelled' })], 'b1')
    expect(cancelled.jobs.map((j) => j.status)).toEqual(['cancelled'])
    expect(cancelled.active.size).toBe(0)
    expect(reconcileVanished(cancelled, [], 'b2').jobs).toEqual([])
  })

  it('drops the failure once a new job for the same target appears', () => {
    const first = reconcileVanished(empty, [job({ id: 'a' })])
    const gone = reconcileVanished(first, [])
    const retried = reconcileVanished(gone, [job({ id: 'b', status: 'queued' })])
    expect(retried.jobs.map((j) => j.id)).toEqual(['b'])
    expect(retried.vanished.size).toBe(0)
  })

  it('drops a vanished job silently when the boot id is unchanged (done eviction)', () => {
    const first = reconcileVanished(empty, [job({ id: 'a' })], 'b1')
    const second = reconcileVanished(first, [], 'b1')
    expect(second.jobs).toEqual([])
    expect(second.vanished.size).toBe(0)
  })

  it('fails a vanished job when the boot id changed, and adopts the new id', () => {
    const first = reconcileVanished(empty, [job({ id: 'a' })], 'b1')
    const second = reconcileVanished(first, [], 'b2')
    expect(second.jobs).toMatchObject([{ id: 'a', status: 'error', message: null }])
    expect(second.boot).toBe('b2')
  })

  it('adopts the id on the first snapshot', () => {
    expect(reconcileVanished(empty, [job({ id: 'a' })], 'b1').boot).toBe('b1')
  })

  it('falls back to failing a vanished job when the server sends no boot id', () => {
    const first = reconcileVanished(empty, [job({ id: 'a' })], 'b1')
    expect(reconcileVanished(first, [], null).jobs).toMatchObject([{ status: 'error' }])
  })

  it('still supersedes a failure by a retry under the same boot', () => {
    const first = reconcileVanished(empty, [job({ id: 'a' })], 'b1')
    const gone = reconcileVanished(first, [], 'b2')
    const retried = reconcileVanished(gone, [job({ id: 'b', status: 'queued' })], 'b2')
    expect(retried.jobs.map((j) => j.id)).toEqual(['b'])
  })
})

function folderJob(over: Partial<FolderJob> & Pick<FolderJob, 'id'>): FolderJob {
  return {
    status: 'running',
    folder: '/home/u/Downloads',
    fileName: 'My talk',
    tool: 'curl',
    operation: 'download:curl',
    expectedBytes: null,
    startedAt: null,
    message: null,
    ...over,
  }
}

describe('folder jobs', () => {
  const empty = { active: new Map(), vanished: new Map() }

  it('fails a folder job lost to a server restart, and keeps one merely evicted', () => {
    const first = reconcileVanishedFolder(empty, [folderJob({ id: 'a' })], 'b1')
    expect(reconcileVanishedFolder(first, [], 'b1').jobs).toEqual([])
    expect(reconcileVanishedFolder(first, [], 'b2').jobs).toMatchObject([
      { id: 'a', status: 'error', code: null },
    ])
  })

  it('drops a lost folder job once the same name is downloaded into the same folder again', () => {
    const first = reconcileVanishedFolder(empty, [folderJob({ id: 'a' })], 'b1')
    const lost = reconcileVanishedFolder(first, [], 'b2')
    const again = reconcileVanishedFolder(lost, [folderJob({ id: 'b', status: 'queued' })], 'b2')
    expect(again.jobs.map((j) => j.id)).toEqual(['b'])
  })

  it('labels a failure by the file name for a folder job, the lecture for an app job', () => {
    expect(failedJobLabel(folderJob({ id: 'a', fileName: 'Talk (2).mp4' }))).toBe('Talk (2).mp4')
    expect(failedJobLabel(job({ id: 'b', lecture: 'lecture 3' }))).toBe('lecture 3')
  })
})

describe('splitJobs', () => {
  const wire = (over: Partial<WireJob> & Pick<WireJob, 'id'>): WireJob => ({
    ...job(over),
    ...over,
  })

  it('separates folder jobs, so none reaches a lecture row or the course lock', () => {
    const { jobs, folderJobs } = splitJobs([
      wire({ id: 'app', dest: 'app' }),
      wire({ id: 'old' }),
      {
        ...wire({ id: 'f', dest: 'folder', folder: '/d', fileName: 'Talk', ref: null }),
        course: null,
        lecture: null,
        kind: null,
      } as unknown as WireJob,
    ])
    expect(jobs.map((j) => j.id)).toEqual(['app', 'old'])
    expect(folderJobs).toMatchObject([{ id: 'f', folder: '/d', fileName: 'Talk' }])
    expect(folderJobs[0]).not.toHaveProperty('course')
    expect(coursesWithActiveJobs(jobs)).toEqual(new Set(['Algo']))
  })
})

describe('groupJobsByCourse', () => {
  it('reads one shared empty bucket for a course with no live jobs', () => {
    const byCourse = groupJobsByCourse([job({ id: 'a', status: 'error' })], new Map())
    expect(jobsForCourse(byCourse, 'Algo')).toBe(jobsForCourse(byCourse, 'Other'))
  })

  it('keeps a course bucket identity while its jobs are unchanged', () => {
    const first = groupJobsByCourse([job({ id: 'a' }), job({ id: 'b', course: 'Os' })], new Map())
    const second = groupJobsByCourse(
      [job({ id: 'a' }), job({ id: 'b', course: 'Os', startedAt: 5 })],
      first,
    )
    expect(second.get('Algo')).toBe(first.get('Algo'))
    expect(second.get('Os')).not.toBe(first.get('Os'))
  })
})
