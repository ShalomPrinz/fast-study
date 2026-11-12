import { describe, it, expect } from 'vitest'
import type { DownloadJob } from '../services/downloadServer'
import { placeholderJobs } from './placeholders'

function job(over: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: 'j1',
    status: 'running',
    course: 'C',
    lecture: 'L1',
    kind: 'lecture',
    media: null,
    tool: 'curl',
    operation: null,
    ref: null,
    expectedBytes: null,
    startedAt: null,
    message: null,
    ...over,
  } as DownloadJob
}

const tree = { lectures: [{ name: 'Old' }], recitations: [{ name: 'R0' }] }

describe('placeholderJobs', () => {
  it('shows a running or queued job missing from the tree', () => {
    const jobs = [job(), job({ id: 'j2', status: 'queued', lecture: 'L2' })]
    expect(placeholderJobs(jobs, 'C', tree, 'lecture').map((j) => j.lecture)).toEqual(['L1', 'L2'])
  })

  it('skips a lecture the tree already has, per kind', () => {
    expect(placeholderJobs([job({ lecture: 'Old' })], 'C', tree, 'lecture')).toEqual([])
    // Same name as a lecture but a recitation: not in the recitations, so it shows.
    const rec = job({ lecture: 'Old', kind: 'recitation' })
    expect(placeholderJobs([rec], 'C', tree, 'recitation')).toHaveLength(1)
    expect(placeholderJobs([rec], 'C', tree, 'lecture')).toEqual([])
  })

  it('keeps a done job until the tree has the lecture', () => {
    const done = job({ status: 'done' })
    expect(placeholderJobs([done], 'C', tree, 'lecture')).toHaveLength(1)
    expect(placeholderJobs([done], 'C', { lectures: [{ name: 'L1' }] }, 'lecture')).toEqual([])
  })

  it('drops failed and cancelled jobs', () => {
    const jobs = [job({ status: 'error' }), job({ id: 'j2', status: 'cancelled' })]
    expect(placeholderJobs(jobs, 'C', tree, 'lecture')).toEqual([])
  })

  it('ignores other courses and folder-style jobs without a lecture', () => {
    const jobs = [job({ course: 'Other' }), job({ id: 'j2', lecture: '' })]
    expect(placeholderJobs(jobs, 'C', tree, 'lecture')).toEqual([])
  })

  it('works for a course not in the tree yet', () => {
    expect(placeholderJobs([job()], 'C', undefined, 'lecture')).toHaveLength(1)
  })

  it('puts both kinds in a lectures-only course lecture list', () => {
    const only = { lectures: [], recitations: [], lectures_only: true }
    const jobs = [job(), job({ id: 'j2', kind: 'recitation', lecture: 'R' })]
    expect(placeholderJobs(jobs, 'C', only, 'lecture')).toHaveLength(2)
    expect(placeholderJobs(jobs, 'C', only, 'recitation')).toEqual([])
  })

  it('lists an assignment job only in the Assignments group, until the tree has it', () => {
    const a = job({ lecture: 'HW1', media: 'assignment' })
    expect(placeholderJobs([a], 'C', tree, 'lecture')).toEqual([])
    expect(placeholderJobs([a], 'C', tree, 'recitation')).toEqual([])
    expect(placeholderJobs([a], 'C', { ...tree, lectures_only: true }, 'lecture')).toEqual([])
    expect(placeholderJobs([a], 'C', tree, 'assignment')).toHaveLength(1)
    // A same-named lecture does not hide it; only a listed assignment does.
    expect(placeholderJobs([a], 'C', { lectures: [{ name: 'HW1' }] }, 'assignment')).toHaveLength(1)
    const listed = { ...tree, assignments: [{ name: 'HW1' }] }
    expect(placeholderJobs([{ ...a, status: 'done' }], 'C', listed, 'assignment')).toEqual([])
  })

  it('keeps lecture jobs out of the Assignments group and drops failed assignments', () => {
    expect(placeholderJobs([job()], 'C', tree, 'assignment')).toEqual([])
    const failed = job({ lecture: 'HW1', media: 'assignment', status: 'error' })
    expect(placeholderJobs([failed], 'C', tree, 'assignment')).toEqual([])
  })
})
