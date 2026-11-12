import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import { suggestItemName } from './nameFromTitle'

const lecture = (name: string) => ({ name }) as Lecture

const course = (lectures: string[], recitations: string[] = []): Course[] => [
  {
    name: 'Algebra',
    source_url: null,
    lectures_only: false,
    lectures: lectures.map(lecture),
    recitations: recitations.map(lecture),
    assignments: [],
    skipped: [],
  },
]

describe('suggestItemName', () => {
  it('names a numbered title with the prefix the course already uses', () => {
    const courses = course(['הרצאה 3'], ['תרגול 2'])
    expect(suggestItemName('הרצאה 7', 'lecture', courses, 'Algebra')).toBe('הרצאה 7')
    expect(suggestItemName('תרגול 5', 'recitation', courses, 'Algebra')).toBe('תרגול 5')
    expect(suggestItemName('Week 4', 'lecture', course(['Class 1']), 'Algebra')).toBe('Class 4')
  })

  it('keeps the sub-marker as a decimal on the inferred prefix', () => {
    expect(suggestItemName('הרצאה 11a', 'lecture', course(['הרצאה 3']), 'Algebra')).toBe(
      'הרצאה 11.1',
    )
  })

  it('falls back to the UI locale when the course has nothing to copy', () => {
    expect(suggestItemName('lesson 3', 'lecture', course([]), 'Algebra')).toBe('Lecture 3')
    expect(suggestItemName('lesson 3', 'recitation', course([]), 'Algebra')).toBe('Recitation 3')
    expect(suggestItemName('lesson 3', 'lecture', course(['הרצאה 3']), 'Nope')).toBe('Lecture 3')
  })

  it('falls back to the tree suggestion when the title has no number', () => {
    expect(suggestItemName('רועי', 'recitation', course([], ['תרגול 3']), 'Algebra')).toBe(
      'תרגול 4',
    )
  })

  describe('part marker', () => {
    const c = course(['הרצאה 3'], ['תרגול 2'])
    const en = course(['Lecture 3'], ['Recitation 2'])
    it("makes the part the decimal of the section's number", () => {
      expect(suggestItemName('חלק 1', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 5')).toBe(
        'הרצאה 5.1',
      )
      expect(suggestItemName('part 1', 'lecture', en, 'Algebra', 'lecture', 'lecture 5')).toBe(
        'Lecture 5.1',
      )
      expect(suggestItemName('חלק 2', 'recitation', c, 'Algebra', 'recitation', 'תרגול 4')).toBe(
        'תרגול 4.2',
      )
      expect(
        suggestItemName('Part 2', 'recitation', en, 'Algebra', 'recitation', 'Recitation 4'),
      ).toBe('Recitation 4.2')
    })
    it("makes the part the decimal of the title's own number", () => {
      expect(suggestItemName('הרצאה 5 חלק 1', 'lecture', c, 'Algebra')).toBe('הרצאה 5.1')
      expect(suggestItemName('Lecture 5 - Part 1', 'lecture', en, 'Algebra')).toBe('Lecture 5.1')
      expect(
        suggestItemName('תרגול 4 חלק 2', 'recitation', c, 'Algebra', 'recitation', 'תרגול 9'),
      ).toBe('תרגול 4.2')
      expect(suggestItemName('Recitation 4 part 2', 'recitation', en, 'Algebra')).toBe(
        'Recitation 4.2',
      )
    })
    it('never takes a bare part number as the session number', () => {
      const next = suggestItemName('x', 'lecture', c, 'Algebra')
      expect(suggestItemName('חלק 2', 'lecture', c, 'Algebra', 'lecture', 'שבוע 3')).toBe(next)
      expect(suggestItemName('חלק 2', 'lecture', c, 'Algebra')).toBe(next)
      expect(suggestItemName('part 2', 'lecture', c, 'Algebra', 'lecture', '')).toBe(next)
    })
    it('counts only a keyword number as the base', () => {
      expect(
        suggestItemName('Algebra 2 part 1', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 5'),
      ).toBe('הרצאה 5.1')
      expect(suggestItemName('5 חלק 1', 'lecture', c, 'Algebra')).toBe('הרצאה 5')
    })
    it('gives no decimal when the base already has its own sub-marker', () => {
      expect(suggestItemName('הרצאה 11א חלק 2', 'lecture', c, 'Algebra')).toBe('הרצאה 11')
      expect(suggestItemName('חלק 2', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 3א')).toBe(
        'הרצאה 3',
      )
    })
    it("takes a range heading's first number as the base", () => {
      expect(suggestItemName('חלק 2', 'lecture', c, 'Algebra', 'lecture', 'הרצאות 3-4')).toBe(
        'הרצאה 3.2',
      )
    })
    it('drops the matched marker, not an earlier copy of its text', () => {
      expect(suggestItemName('Department 3 part 3', 'lecture', c, 'Algebra')).toBe('הרצאה 3')
      expect(suggestItemName('Department 3a part 3', 'lecture', c, 'Algebra')).toBe('הרצאה 3.1')
    })
  })

  describe('section heading', () => {
    const c = course(['הרצאה 3'])
    it('numbers a numberless title from a keyword section, sub-marker included', () => {
      expect(suggestItemName('הקלטה', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 1: מבוא')).toBe(
        'הרצאה 1',
      )
      expect(suggestItemName('שקפים', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 1: מבוא')).toBe(
        'הרצאה 1',
      )
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 3א')).toBe('הרצאה 3.1')
    })
    it('lets a title number beat the section', () => {
      expect(suggestItemName('הרצאה 7', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 1')).toBe(
        'הרצאה 7',
      )
    })
    it('ignores date ranges and week headings', () => {
      const next = suggestItemName('x', 'lecture', c, 'Algebra')
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', '12/03 - 18/03')).toBe(next)
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', 'שבוע 3')).toBe(next)
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 12.05.24')).toBe(next)
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 12/3')).toBe(next)
    })
    it('takes the first number of a range heading, no sub-marker', () => {
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', 'הרצאות 3-4')).toBe('הרצאה 3')
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', 'הרצאות 3–4')).toBe('הרצאה 3')
    })
    it('accepts a trailing period', () => {
      expect(suggestItemName('x', 'lecture', c, 'Algebra', 'lecture', 'הרצאה 3.')).toBe('הרצאה 3')
    })
    it('keeps the recitation prefix in a lectures-only course', () => {
      const lo = [{ ...course(['הרצאה 1'], ['תרגול 1'])[0], lectures_only: true }]
      expect(suggestItemName('x', 'lecture', lo, 'Algebra', 'recitation', 'תרגול 2')).toBe(
        'תרגול 2',
      )
    })
  })
})
