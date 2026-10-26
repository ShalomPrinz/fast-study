import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import {
  assignmentDocNotFound,
  courseNotFound,
  lectureNotFound,
  routeMiss,
} from '@/shared/utils/notFound'

const lecture = (name: string) => ({ name }) as Lecture

const courses: Course[] = [
  {
    name: 'Operating Systems',
    archived: false,
    source_url: null,
    lectures_only: false,
    lectures: [lecture('Lecture 1')],
    recitations: [lecture('Tirgul 3')],
    assignments: [],
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

describe('routeMiss', () => {
  it('renders the page when the target is in the tree, failed refresh or not', () => {
    expect(routeMiss(null, false)).toBeNull()
    expect(routeMiss(null, true)).toBeNull()
  })

  it('keeps the not-found message after a good load', () => {
    expect(routeMiss('gone', false)).toEqual({ message: 'gone', failed: false })
  })

  it('blames the failed load, not the target, when the newest load failed', () => {
    expect(routeMiss('gone', true)).toEqual({ message: 'Courses failed to load.', failed: true })
  })
})

describe('assignmentDocNotFound', () => {
  const info = { md_mtime: 1, pdf_mtime: null, pdf_warning: null }
  const withDocs = (docs: Course['assignments'][number]['docs']): Course[] => [
    {
      ...courses[0],
      assignments: [{ name: 'HW1', docs } as Course['assignments'][number]],
    },
  ]
  const tree = withDocs({ intuition: info, solution: null })

  it('returns null for a doc the assignment holds', () => {
    expect(assignmentDocNotFound(tree, 'Operating Systems', 'HW1', 'intuition')).toBeNull()
  })

  it('names the missing doc file when it is not generated', () => {
    expect(assignmentDocNotFound(tree, 'Operating Systems', 'HW1', 'solution')).toBe(
      'solution.md was not found.',
    )
  })

  it('rejects a doc that is not one of the two names', () => {
    expect(assignmentDocNotFound(tree, 'Operating Systems', 'HW1', 'summary')).toBe(
      'summary.md was not found.',
    )
  })

  it('blames the assignment when it is missing', () => {
    expect(assignmentDocNotFound(tree, 'Operating Systems', 'HW9', 'intuition')).toBe(
      `"Operating Systems" has no assignment named "HW9".`,
    )
  })
})
