import type { Course, Lecture } from '@/types'

// A lecture counts as complete once `drive_url.txt` exists — the last output the pipeline writes, so
// its presence implies every earlier stage ran.
export function isLectureComplete(lecture: Lecture): boolean {
  return lecture.files['drive_url.txt'].exists
}

// A course's sidebar `N/M`: lectures and recitations together, archived courses contributing nothing.
export function courseProgress(course: Course): { complete: number; total: number } {
  if (course.archived) return { complete: 0, total: 0 }
  const items = [...course.lectures, ...course.recitations]
  return { complete: items.filter(isLectureComplete).length, total: items.length }
}
