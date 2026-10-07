import { describe, it, expect } from 'vitest'
import type { InFlightEntry, Kind, QueueEntry } from '@/types'
import { isCourseRenameLocked, isLectureRenameLocked } from './renameLock'

const queued = (course: string, lecture: string, kind: Kind = 'lecture'): QueueEntry => ({
  course,
  lecture,
  kind,
  depth: 'full',
})

const running = (course: string, lecture: string, kind: Kind = 'lecture'): InFlightEntry => ({
  course,
  lecture,
  kind,
  step: 'transcribe',
  startedAt: '2026-01-01T00:00:00Z',
})

describe('isLectureRenameLocked', () => {
  it('locks a running lecture', () => {
    const status = { inFlight: [running('c', 'L1')], queue: [], overviewRunning: [] }
    expect(isLectureRenameLocked(status, 'c', 'L1', 'lecture')).toBe(true)
  })

  it('locks a queued lecture', () => {
    const status = { inFlight: [], queue: [queued('c', 'L1')], overviewRunning: [] }
    expect(isLectureRenameLocked(status, 'c', 'L1', 'lecture')).toBe(true)
  })

  it('leaves idle siblings, other kinds and other courses unlocked', () => {
    const status = {
      inFlight: [running('c', 'L1')],
      queue: [queued('c', 'L2')],
      overviewRunning: [],
    }
    expect(isLectureRenameLocked(status, 'c', 'L3', 'lecture')).toBe(false)
    expect(isLectureRenameLocked(status, 'c', 'L1', 'recitation')).toBe(false)
    expect(isLectureRenameLocked(status, 'd', 'L1', 'lecture')).toBe(false)
  })

  it('is unlocked before the first status arrives', () => {
    expect(isLectureRenameLocked(null, 'c', 'L1', 'lecture')).toBe(false)
  })
})

describe('isCourseRenameLocked', () => {
  it('locks a course with a running or queued lecture or recitation', () => {
    expect(
      isCourseRenameLocked({ inFlight: [running('c', 'L1')], queue: [], overviewRunning: [] }, 'c'),
    ).toBe(true)
    expect(
      isCourseRenameLocked(
        { inFlight: [], queue: [queued('c', 'R1', 'recitation')], overviewRunning: [] },
        'c',
      ),
    ).toBe(true)
  })

  it('leaves a course unlocked when only another course runs', () => {
    const status = {
      inFlight: [running('d', 'L1')],
      queue: [queued('d', 'L2')],
      overviewRunning: ['d'],
    }
    expect(isCourseRenameLocked(status, 'c')).toBe(false)
    expect(isCourseRenameLocked(null, 'c')).toBe(false)
  })

  it('locks a course whose overview is generating, with no lecture running', () => {
    const status = { inFlight: [], queue: [], overviewRunning: ['c'] }
    expect(isCourseRenameLocked(status, 'c')).toBe(true)
  })

  it("leaves a lecture unlocked by its course's overview generation", () => {
    const status = { inFlight: [], queue: [], overviewRunning: ['c'] }
    expect(isLectureRenameLocked(status, 'c', 'L1', 'lecture')).toBe(false)
  })
})
