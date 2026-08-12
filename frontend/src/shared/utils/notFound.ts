import type { Course, Kind } from '@/types'

// Route params name a course/lecture that may not exist on disk. These build the message for that
// case, and return null when the target is real.

export function courseNotFound(courses: Course[], course: string): string | null {
  return courses.some((c) => c.name === course) ? null : `Course "${course}" doesn't exist.`
}

export function lectureNotFound(
  courses: Course[],
  course: string,
  lecture: string,
  kind: Kind,
): string | null {
  const found = courses.find((c) => c.name === course)
  if (!found) return courseNotFound(courses, course)
  const list = kind === 'recitation' ? found.recitations : found.lectures
  if (list.some((l) => l.name === lecture)) return null
  return `"${course}" has no ${kind} named "${lecture}".`
}
