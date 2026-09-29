import type { Course, FileStatus, Lecture } from '@/types'
import { PIPELINE } from '@/features/lectures/constants/pipeline'

// Done once the last output exists (`drive_url.txt`, or `summary.pdf` with Drive off), mirroring
// the backend's `final_output()`.
export function filesComplete(files: FileStatus, driveEnabled: boolean): boolean {
  return files[driveEnabled ? 'drive_url.txt' : 'summary.pdf'].exists
}

export function isLectureComplete(lecture: Lecture, driveEnabled: boolean): boolean {
  return filesComplete(lecture.files, driveEnabled)
}

// Whether Run Remaining would do anything: the backend's `next_step` (the first enabled step whose
// output is missing, none once complete) must exist and have its input file, or the run fails on it.
export function canRunRemaining(files: FileStatus, driveEnabled: boolean): boolean {
  if (filesComplete(files, driveEnabled)) return false
  const next = PIPELINE.find(
    (p) => p.step && (driveEnabled || p.step !== 'drive') && !files[p.file].exists,
  )
  return !!next && (!next.prereq || files[next.prereq].exists)
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
