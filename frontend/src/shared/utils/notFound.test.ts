import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import { courseNotFound, lectureNotFound } from '@/shared/utils/notFound'

const lecture = (name: string) => ({ name }) as Lecture

const courses: Course[] = [
  {
    name: 'Operating Systems',
    archived: false,
    source_url: null,
    lectures: [lecture('Lecture 1')],
    recitations: [lecture('Tirgul 3')],
  },
]

describe('courseNotFound', () => {
  it('returns null for a course in the tree', () => {
    expect(courseNotFound(courses, 'Operating Systems')).toBeNull()
  })

  it('names the missing course', () => {
    expect(courseNotFound(courses, 'ZZ Cache Test')).toBe(`Course "ZZ Cache Test" doesn't exist.`)
  })
})

describe('lectureNotFound', () => {
  it('returns null for a lecture in the tree', () => {
    expect(lectureNotFound(courses, 'Operating Systems', 'Lecture 1', 'lecture')).toBeNull()
  })

  it('returns null for a recitation in the tree', () => {
    expect(lectureNotFound(courses, 'Operating Systems', 'Tirgul 3', 'recitation')).toBeNull()
  })

  it('blames the course, not the lecture, when the course is missing', () => {
    expect(lectureNotFound(courses, 'ZZ Cache Test', 'Lecture 1', 'lecture')).toBe(
      `Course "ZZ Cache Test" doesn't exist.`,
    )
  })

  it('names the missing lecture within an existing course', () => {
    expect(lectureNotFound(courses, 'Operating Systems', 'Lecture 999', 'lecture')).toBe(
      `"Operating Systems" has no lecture named "Lecture 999".`,
    )
  })

  it('says recitation when the kind is recitation', () => {
    expect(lectureNotFound(courses, 'Operating Systems', 'Lecture 1', 'recitation')).toBe(
      `"Operating Systems" has no recitation named "Lecture 1".`,
    )
  })
})
