import type { Course } from '@/types'

// What the course bar does once a just-added course shows up in the tree: pick it, and load it
// only when it has a source (a source-less pick would otherwise open the edit panel).
export function addedCoursePick(
  courses: readonly Course[],
  name: string,
): { course: Course; load: boolean } | null {
  const course = courses.find((c) => c.name === name)
  return course ? { course, load: !!course.source_url } : null
}
