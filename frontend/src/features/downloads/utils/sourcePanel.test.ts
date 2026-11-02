import { describe, expect, it } from 'vitest'
import { boxCourse } from './sourcePanel'

describe('boxCourse', () => {
  it('names the edit route course over the picked one', () => {
    expect(boxCourse('B', 'A', true)).toBe('A')
  })

  it('keeps the picked course off a panel route, or when the edit course is unknown', () => {
    expect(boxCourse('B', null, false)).toBe('B')
    expect(boxCourse('B', 'A', false)).toBe('B')
  })
})
