import { describe, expect, it } from 'vitest'
import { boxCourse, loadNoteFor } from './sourcePanel'

describe('boxCourse', () => {
  it('names the edit route course over the picked one', () => {
    expect(boxCourse('B', 'A', true)).toBe('A')
  })

  it('keeps the picked course off a panel route, or when the edit course is unknown', () => {
    expect(boxCourse('B', null, false)).toBe('B')
    expect(boxCourse('B', 'A', false)).toBe('B')
  })
})

describe('loadNoteFor', () => {
  it('drops the barred reason over a failure of this course', () => {
    expect(loadNoteFor('Busy', true, false)).toBeNull()
  })

  it('keeps the disconnected reason over a failure, and any reason otherwise', () => {
    expect(loadNoteFor('Connect first', true, true)).toBe('Connect first')
    expect(loadNoteFor('Busy', false, false)).toBe('Busy')
  })
})
