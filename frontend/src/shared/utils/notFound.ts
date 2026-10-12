import { t } from '@lingui/core/macro'
import type { Course, Kind } from '@/types'

// Route params name a course/lecture that may not exist on disk. These build the message for that
// case, and return null when the target is real.

export function courseNotFound(courses: Course[], course: string): string | null {
  return courses.some((c) => c.name === course) ? null : t`Course "${course}" doesn't exist.`
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
  // Two whole messages rather than an interpolated kind: the noun inflects with the sentence.
  return kind === 'recitation'
    ? t`"${course}" has no recitation named "${lecture}".`
    : t`"${course}" has no lecture named "${lecture}".`
}

// A target missing from a tree whose newest load failed is judged against a stale or empty tree, so
// the honest message is the failed load; a target the held tree still has renders normally.
export function routeMiss(
  missing: string | null,
  loadFailed: boolean,
): { message: string; failed: boolean } | null {
  if (!missing) return null
  return loadFailed
    ? { message: t`Courses failed to load.`, failed: true }
    : { message: missing, failed: false }
}
