import { describe, expect, it } from 'vitest'
import type { Course } from '@/types'
import { addedCoursePick } from './addedCourse'

const course = (name: string, source_url?: string, archived = false) =>
  ({ name, source_url, archived }) as Course

describe('addedCoursePick', () => {
  it('loads an added course that has a source', () => {
    expect(addedCoursePick([course('a', 'https://x')], 'a')?.load).toBe(true)
  })

  it('picks a source-less course without loading it', () => {
    expect(addedCoursePick([course('a')], 'a')?.load).toBe(false)
  })

  it('finds nothing until the course is in the tree, or when it is archived', () => {
    expect(addedCoursePick([course('b')], 'a')).toBeNull()
    expect(addedCoursePick([course('a', 'https://x', true)], 'a')).toBeNull()
  })
})
