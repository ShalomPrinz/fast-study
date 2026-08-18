import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import { latestName, suggestName } from './nextName'

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

describe('latestName', () => {
  it('reads the prefix off the name rather than assuming one', () => {
    expect(latestName(['הרצאה 3'], 'lecture')).toMatchObject({ prefix: 'הרצאה', n: 3, sub: 0 })
    expect(latestName(['Lecture 7'], 'lecture')).toMatchObject({ prefix: 'Lecture', n: 7 })
    expect(latestName(['Class 2.1'], 'lecture')).toMatchObject({ prefix: 'Class', n: 2, sub: 1 })
  })

  it('picks the highest number, then the highest sub, whatever the array order', () => {
    expect(latestName(['הרצאה 2', 'הרצאה 10', 'הרצאה 4'], 'lecture')?.n).toBe(10)
    expect(latestName(['Lecture 5.2', 'Lecture 5', 'Lecture 5.1'], 'lecture')?.sub).toBe(2)
  })

  it('rejects a sub-session form for recitations, which have none', () => {
    expect(latestName(['תרגול 3.1'], 'recitation')).toBeNull()
    expect(latestName(['תרגול 3'], 'recitation')).toMatchObject({ prefix: 'תרגול', n: 3 })
  })

  it('is null when nothing carries a trailing number', () => {
    expect(latestName([], 'lecture')).toBeNull()
    expect(latestName(['intro', '2024'], 'lecture')).toBeNull()
  })
})

describe('suggestName', () => {
  it('reuses the English prefix a course already established', () => {
    expect(suggestName(course(['Lecture 7']), 'Algebra', 'lecture')).toBe('Lecture 8')
    expect(suggestName(course([], ['Recitation 4']), 'Algebra', 'recitation')).toBe('Recitation 5')
  })

  it('reuses a Hebrew prefix the same way', () => {
    expect(suggestName(course(['הרצאה 3']), 'Algebra', 'lecture')).toBe('הרצאה 4')
    expect(suggestName(course([], ['תרגול 1']), 'Algebra', 'recitation')).toBe('תרגול 2')
  })

  it('follows the latest name in a course that mixes languages', () => {
    expect(suggestName(course(['Lecture 2', 'הרצאה 5']), 'Algebra', 'lecture')).toBe('הרצאה 6')
    expect(suggestName(course(['הרצאה 5', 'Lecture 9']), 'Algebra', 'lecture')).toBe('Lecture 10')
  })

  it('offers the second half of a split session, then moves on', () => {
    expect(suggestName(course(['הרצאה 4.1']), 'Algebra', 'lecture')).toBe('הרצאה 4.2')
    expect(suggestName(course(['הרצאה 4.2']), 'Algebra', 'lecture')).toBe('הרצאה 5')
  })

  it('falls back to the UI locale when the course has nothing to copy', () => {
    expect(suggestName(course([]), 'Algebra', 'lecture')).toBe('Lecture 1')
    expect(suggestName(course([]), 'Algebra', 'recitation')).toBe('Recitation 1')
    expect(suggestName(course(['intro']), 'Algebra', 'lecture')).toBe('Lecture 1')
  })

  it('has nothing to suggest for a course that is not in the tree', () => {
    expect(suggestName(course([]), 'Missing', 'lecture')).toBe('')
    expect(suggestName(course([]), 'Missing', 'recitation')).toBe('Recitation 1')
  })
})
