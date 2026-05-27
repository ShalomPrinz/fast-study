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
