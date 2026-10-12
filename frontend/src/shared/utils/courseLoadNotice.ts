import type { Course } from '@/types'

export type CourseLoadNotice = 'no-courses' | 'failed' | null

// Which nothing-to-show card a page owes for its courses: only active ones count, and none shows
// before the first load settles. A failed load wins whenever there is nothing to show.
export function courseLoadNotice(
  courses: Course[],
  loaded: boolean,
  loadFailed: boolean,
): CourseLoadNotice {
  if (courses.some((c) => !c.archived)) return null
  if (loadFailed) return 'failed'
  return loaded ? 'no-courses' : null
}
