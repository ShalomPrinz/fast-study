import type { Course, InFlightEntry, Kind, QueueEntry } from '@/types'
import { isLectureComplete } from '@/features/lectures/utils/lectureProgress'
import { inFlightKey } from '@/shared/utils/inFlightKey'

export interface PendingLecture {
  course: string
  lecture: string
  kind: Kind
}

/** Lectures with a video and no final output that nothing is scheduled to pick up. The backend
 *  never reports these — the tree is already in memory, and the queue is what it lacks. */
export function notQueued(
  courses: Course[],
  queue: QueueEntry[],
  inFlight: InFlightEntry[],
  driveEnabled: boolean,
): PendingLecture[] {
  const spokenFor = new Set(
    [...queue, ...inFlight].map((e) => inFlightKey(e.course, e.lecture, e.kind)),
  )
  const out: PendingLecture[] = []
  for (const course of courses) {
    // An archived course is out of the runner's reach, the same way it contributes no progress.
    if (course.archived) continue
    const groups: [Kind, typeof course.lectures][] = [
      ['lecture', course.lectures],
      ['recitation', course.recitations],
    ]
    for (const [kind, lectures] of groups) {
      for (const lecture of lectures) {
        if (!lecture.files['video.mp4'].exists) continue
        if (isLectureComplete(lecture, driveEnabled)) continue
        if (spokenFor.has(inFlightKey(course.name, lecture.name, kind))) continue
        out.push({ course: course.name, lecture: lecture.name, kind })
      }
    }
  }
  return out
}
