import type { Kind, RunnerStatus } from '@/types'
import { inFlightKey } from '@/shared/utils/inFlightKey'

type RunSnapshot = Pick<RunnerStatus, 'inFlight' | 'queue' | 'overviewRunning'> | null

// Queued counts too: the runner takes a queue entry by the name it was queued under, so a rename
// before it starts sends the run to a folder that no longer exists.
function spokenFor(status: RunSnapshot) {
  return [...(status?.queue ?? []), ...(status?.inFlight ?? [])]
}

/** Whether renaming this lecture/recitation must wait: a run is on it or waiting for it. */
export function isLectureRenameLocked(
  status: RunSnapshot,
  course: string,
  lecture: string,
  kind: Kind,
): boolean {
  const key = inFlightKey(course, lecture, kind)
  return spokenFor(status).some((e) => inFlightKey(e.course, e.lecture, e.kind) === key)
}

/** Whether renaming this course must wait: any of its lectures, or its overview, is running or queued. */
export function isCourseRenameLocked(status: RunSnapshot, course: string): boolean {
  return (
    !!status?.overviewRunning.includes(course) || spokenFor(status).some((e) => e.course === course)
  )
}
