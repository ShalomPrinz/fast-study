import { describe, expect, it } from 'vitest'
import type { Course } from '@/types'
import { isTreeEmpty } from './courseTree'

const course = { name: 'A', archived: true } as Course

describe('isTreeEmpty', () => {
  it('waits for the tree to settle', () => {
    expect(isTreeEmpty([], false, false)).toBe(false)
  })
  it('is empty once settled with no course', () => {
    expect(isTreeEmpty([], true, false)).toBe(true)
  })
  it('is never empty after a failed load', () => {
    expect(isTreeEmpty([], true, true)).toBe(false)
  })
  it('counts an archived course as a course', () => {
    expect(isTreeEmpty([course], true, false)).toBe(false)
  })
})
