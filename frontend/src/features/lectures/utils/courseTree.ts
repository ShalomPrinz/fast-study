import type { Course, Lecture, Kind } from '@/types'

export function findLecture(
  courses: Course[],
  courseName: string,
  lectureName: string,
  kind: Kind,
): Lecture | null {
  const course = courses.find((c) => c.name === courseName)
  const list = kind === 'recitation' ? course?.recitations : course?.lectures
  return list?.find((l) => l.name === lectureName) ?? null
}

// The pane's empty state: a load that succeeded and holds no course at all, archived ones included.
export function isTreeEmpty(courses: Course[], loaded: boolean, loadFailed: boolean): boolean {
  return loaded && !loadFailed && courses.length === 0
}
