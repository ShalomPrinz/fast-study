import type { Course, Lecture } from '@/types'

// Complete once the last output exists (`drive_url.txt`, or `summary.pdf` with Drive off), mirroring
// the backend's `final_output()`.
export function isLectureComplete(lecture: Lecture, driveEnabled: boolean): boolean {
  return lecture.files[driveEnabled ? 'drive_url.txt' : 'summary.pdf'].exists
}

// A course's sidebar `N/M`: lectures and recitations together, archived courses contributing nothing.
export function courseProgress(
  course: Course,
  driveEnabled: boolean,
): { complete: number; total: number } {
  if (course.archived) return { complete: 0, total: 0 }
  const items = [...course.lectures, ...course.recitations]
  return {
    complete: items.filter((l) => isLectureComplete(l, driveEnabled)).length,
    total: items.length,
  }
}
