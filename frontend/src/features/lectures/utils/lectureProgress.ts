import type { Course, Lecture } from '@/types'

// A lecture counts as complete once the pipeline's last output exists — `drive_url.txt`, or
// `summary.pdf` with Drive off. Mirrors the backend's `final_output()`, which decides what the
// runner still picks up; its presence implies every earlier stage ran.
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
