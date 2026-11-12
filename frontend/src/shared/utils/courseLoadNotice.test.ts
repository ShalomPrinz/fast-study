import { describe, expect, it } from 'vitest'
import type { Course } from '@/types'
import { courseLoadNotice, isCourseTreeLoading } from './courseLoadNotice'

const course = { name: 'A' } as Course

describe('courseLoadNotice', () => {
  it('waits for the first load to settle', () => {
    expect(courseLoadNotice([], false, false)).toBe(null)
  })
  it('hints once a good load holds no course', () => {
    expect(courseLoadNotice([], true, false)).toBe('no-courses')
  })
  it('reports a failed load with nothing to show', () => {
    expect(courseLoadNotice([], true, true)).toBe('failed')
    expect(courseLoadNotice([], false, true)).toBe('failed')
  })
  it('stays quiet while courses are shown, failed refresh or not', () => {
    expect(courseLoadNotice([course], true, false)).toBe(null)
    expect(courseLoadNotice([course], true, true)).toBe(null)
  })
})

describe('isCourseTreeLoading', () => {
  it('is true only before the first load settles with nothing to show', () => {
    expect(isCourseTreeLoading([], false, false)).toBe(true)
    expect(isCourseTreeLoading([], true, false)).toBe(false)
    expect(isCourseTreeLoading([], false, true)).toBe(false)
    expect(isCourseTreeLoading([course], false, false)).toBe(false)
  })
})
