import { describe, expect, it } from 'vitest'
import type { Course } from '@/types'
import { courseLoadNotice } from './courseLoadNotice'

const active = { name: 'A', archived: false } as Course
const archived = { name: 'B', archived: true } as Course

describe('courseLoadNotice', () => {
  it('waits for the first load to settle', () => {
    expect(courseLoadNotice([], false, false)).toBe(null)
  })
  it('hints once a good load holds no course', () => {
    expect(courseLoadNotice([], true, false)).toBe('no-courses')
  })
  it('counts only active courses', () => {
    expect(courseLoadNotice([archived], true, false)).toBe('no-courses')
  })
  it('reports a failed load with nothing to show', () => {
    expect(courseLoadNotice([], true, true)).toBe('failed')
    expect(courseLoadNotice([archived], false, true)).toBe('failed')
  })
  it('stays quiet while active courses are shown, failed refresh or not', () => {
    expect(courseLoadNotice([active], true, false)).toBe(null)
    expect(courseLoadNotice([active], true, true)).toBe(null)
  })
})
