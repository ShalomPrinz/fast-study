import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import { suggestItemName } from './nameFromTitle'

const lecture = (name: string) => ({ name }) as Lecture

const course = (lectures: string[], recitations: string[] = []): Course[] => [
  {
    name: 'Algebra',
    archived: false,
    source_url: null,
    lectures: lectures.map(lecture),
    recitations: recitations.map(lecture),
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
    expect(suggestItemName('הרצאה 11a', 'lecture', course(['הרצאה 3']), 'Algebra')).toBe('הרצאה 11.1')
  })

  it('falls back to the UI locale when the course has nothing to copy', () => {
    expect(suggestItemName('lesson 3', 'lecture', course([]), 'Algebra')).toBe('Lecture 3')
    expect(suggestItemName('lesson 3', 'recitation', course([]), 'Algebra')).toBe('Recitation 3')
    expect(suggestItemName('lesson 3', 'lecture', course(['הרצאה 3']), 'Nope')).toBe('Lecture 3')
  })

  it('falls back to the tree suggestion when the title has no number', () => {
    expect(suggestItemName('רועי', 'recitation', course([], ['תרגול 3']), 'Algebra')).toBe('תרגול 4')
  })
})
