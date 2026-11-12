import type { Course } from '@/types'

export type CourseLoadNotice = 'no-courses' | 'failed' | null

// Which nothing-to-show card a page owes for its courses: none shows
// before the first load settles. A failed load wins whenever there is nothing to show.
export function courseLoadNotice(
  courses: Course[],
  loaded: boolean,
  loadFailed: boolean,
): CourseLoadNotice {
  if (courses.length) return null
  if (loadFailed) return 'failed'
  return loaded ? 'no-courses' : null
}

// True while the first load is still pending and there is nothing to show yet.
export function isCourseTreeLoading(
  courses: Course[],
  loaded: boolean,
  loadFailed: boolean,
): boolean {
  return !loaded && !loadFailed && !courses.length
}
