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

export function assignmentNotFound(
  courses: Course[],
  course: string,
  assignment: string,
): string | null {
  const found = courses.find((c) => c.name === course)
  if (!found) return courseNotFound(courses, course)
  if (found.assignments.some((a) => a.name === assignment)) return null
  return t`"${course}" has no assignment named "${assignment}".`
}

// An assignment doc's editor target: the assignment must exist and hold a generated md for `doc`,
// which must itself be one of the two names.
export function assignmentDocNotFound(
  courses: Course[],
  course: string,
  assignment: string,
  doc: string,
): string | null {
  const missing = assignmentNotFound(courses, course, assignment)
  if (missing) return missing
  const node = courses
    .find((c) => c.name === course)
    ?.assignments.find((a) => a.name === assignment)
  const info = doc === 'intuition' || doc === 'solution' ? node?.docs[doc] : null
  if (info) return null
  const file = `${doc}.md`
  return t`${file} was not found.`
}
