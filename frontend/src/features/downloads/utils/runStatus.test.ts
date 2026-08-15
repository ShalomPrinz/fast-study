import { describe, it, expect } from 'vitest'
import type { Course, FileInfo, FileStatus, Lecture } from '@/types'
import type { DownloadJob, RunTarget } from '../services/downloadServer'
import { groupJobsByRef } from '../contexts/DownloadJobsContext'
import { summarize, targetStatus } from './runStatus'

const EMPTY: FileInfo = { exists: false, size: null, mtime: null }
const PRESENT: FileInfo = { exists: true, size: 10, mtime: 1 }

function node(name: string, video = false): Lecture {
  const files = {
    'video.mp4': video ? PRESENT : EMPTY,
    'audio.mp3': EMPTY,
    'transcript.txt': EMPTY,
    'transcript.partial.txt': EMPTY,
    'summary.md': EMPTY,
    'summary.pdf': EMPTY,
    'drive_url.txt': EMPTY,
  } satisfies FileStatus
  return { name, files, materials: [], transcribePartial: null }
}

function tree(lectures: Lecture[]): Course[] {
  return [{ name: 'Algebra', archived: false, source_url: null, lectures, recitations: [] }]
}

function job(over: Partial<DownloadJob> & Pick<DownloadJob, 'id'>): DownloadJob {
  return {
    status: 'running',
    course: 'Algebra',
    lecture: 'Lecture 1',
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

function target(over: Partial<RunTarget> = {}): RunTarget {
  return {
    ref: 'r1',
    name: 'Lecture 1',
    kind: 'lecture',
    media: 'video',
    disposition: 'queued',
    ...over,
  }
}

const NO_JOBS = groupJobsByRef([])
const status = (t: RunTarget, courses: Course[], jobs = NO_JOBS) =>
  targetStatus(t, courses, 'Algebra', jobs)

describe('targetStatus', () => {
  it('is downloaded once the row landed in the course tree', () => {
    expect(status(target(), tree([node('Lecture 1', true)]))).toBe('downloaded')
  })

  it('is downloaded when a zoom share split into siblings instead of the queued name', () => {
    const courses = tree([node('Lecture 1.1', true), node('Lecture 1.2', true)])
    expect(status(target(), courses)).toBe('downloaded')
  })

  it('is failed when the ref holds an error job and nothing landed', () => {
    const jobs = groupJobsByRef([job({ id: 'a', status: 'error' })])
    expect(status(target(), tree([]), jobs)).toBe('failed')
  })

  it('is in flight while no job is visible yet — the window right after the POST', () => {
    expect(status(target(), tree([]))).toBe('in-flight')
  })

  it('is in flight while the job runs, and on a done job whose tree entry has not arrived', () => {
    const running = groupJobsByRef([job({ id: 'a' })])
    expect(status(target(), tree([]), running)).toBe('in-flight')
    const done = groupJobsByRef([job({ id: 'a', status: 'done' })])
    expect(status(target(), tree([]), done)).toBe('in-flight')
  })

  it('stays in flight while a zoom share still runs clip 2, though clip 1 landed', () => {
    const courses = tree([node('Lecture 1.1', true)])
    const jobs = groupJobsByRef([
      job({ id: 'a', lecture: 'Lecture 1.1', status: 'done' }),
      job({ id: 'b', lecture: 'Lecture 1.2' }),
    ])
    expect(status(target(), courses, jobs)).toBe('in-flight')
  })

  it('ignores split siblings left by an earlier run that hold no video', () => {
    const courses = tree([node('Lecture 1.1'), node('Lecture 1.2')])
    expect(status(target(), courses)).toBe('in-flight')
  })

  it("ignores an error job left under the ref by the row's previous name", () => {
    const jobs = groupJobsByRef([job({ id: 'a', lecture: 'Old name', status: 'error' })])
    expect(status(target(), tree([]), jobs)).toBe('in-flight')
  })

  it('lets the tree win over an error job left by an earlier attempt', () => {
    const jobs = groupJobsByRef([job({ id: 'a', status: 'error' })])
    expect(status(target(), tree([node('Lecture 1', true)]), jobs)).toBe('downloaded')
  })

  it('passes each recorded disposition through, whatever the tree and the jobs say', () => {
    const courses = tree([node('Lecture 1', true)])
    const jobs = groupJobsByRef([job({ id: 'a', status: 'error' })])
    expect(status(target({ disposition: 'skipped' }), courses, jobs)).toBe('skipped')
    expect(
      status(target({ disposition: 'unsupported', media: 'unsupported' }), courses, jobs),
    ).toBe('unsupported')
    expect(status(target({ disposition: 'queue-failed' }), courses, jobs)).toBe('failed')
  })

  it('leaves a row the queue has not reached pending, not in flight', () => {
    const jobs = groupJobsByRef([job({ id: 'a', status: 'error' })])
    expect(status(target({ disposition: 'pending' }), tree([]), jobs)).toBe('pending')
  })

  it('never claims an unprobed unknown row landed', () => {
    expect(status(target({ media: 'unknown' }), tree([node('Lecture 1', true)]))).toBe('in-flight')
  })
})

describe('summarize', () => {
  it('counts a queued row as downloaded only once the tree holds it', () => {
    const targets = [target(), target({ ref: 'r2', name: 'Lecture 2' })]
    const jobs = groupJobsByRef([
      job({ id: 'a', ref: 'r2', lecture: 'Lecture 2', status: 'error' }),
    ])
    expect(summarize(targets, tree([node('Lecture 1', true)]), 'Algebra', jobs)).toBe(
      '1 downloaded, 1 failed',
    )
  })

  it('omits every zero part and keeps the recorded ones', () => {
    const targets = [
      target({ ref: 'r1', disposition: 'skipped' }),
      target({ ref: 'r2', disposition: 'skipped' }),
      target({ ref: 'r3', disposition: 'unsupported', media: 'unsupported' }),
    ]
    expect(summarize(targets, tree([]), 'Algebra', NO_JOBS)).toBe(
      '0 downloaded, 1 unsupported, 2 already there',
    )
  })

  it('counts in-flight rows nowhere — the header shows them as their own state', () => {
    expect(summarize([target()], tree([]), 'Algebra', NO_JOBS)).toBe('0 downloaded')
  })

  it('counts the queue tail nowhere either, so a cancelled run reports only what it did', () => {
    const targets = [
      target({ disposition: 'skipped' }),
      target({ ref: 'r2', name: 'Lecture 2', disposition: 'pending' }),
      target({ ref: 'r3', name: 'Lecture 3', disposition: 'pending' }),
    ]
    expect(summarize(targets, tree([]), 'Algebra', NO_JOBS)).toBe('0 downloaded, 1 already there')
  })
})
