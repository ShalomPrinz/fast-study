import type { Course, Kind, Lecture } from '@/types'
import type { DownloadJob } from '@/features/downloads/services/downloadServer'
import { suggestName } from '@/features/lectures/utils/nextName'

// Where a manual download lands, in the spelling the server stored it under.
export interface StoredTarget {
  course: string
  lecture: string
}

// `/download-url`'s `target` is `course/lecture`; neither stored name can hold a `/`, so the first
// one splits them. Null for anything else.
export function parseTarget(target: string): StoredTarget | null {
  const at = target.indexOf('/')
  if (at <= 0 || at === target.length - 1) return null
  return { course: target.slice(0, at), lecture: target.slice(at + 1) }
}

export type ManualStatus = 'queued' | 'running' | 'done' | 'error'

// A manual job's state. Off `/jobs` it is either not refetched yet or a `done` job past its eviction
// bridge — which waits for the tree, so the video already being in the course tells them apart.
export function manualStatus(job: DownloadJob | null, landed: boolean): ManualStatus {
  if (!job) return landed ? 'done' : 'queued'
  // A queued job is 'running' here: its bar already reads "Estimating…" until it starts.
  return job.status === 'done' || job.status === 'error' ? job.status : 'running'
}

// The tree's next free name, also skipping names this session's manual downloads already claimed —
// an in-flight one isn't in the tree yet, so two downloads in a row would otherwise share a name.
export function suggestManualName(
  courses: Course[],
  course: string,
  kind: Kind,
  claimed: readonly (StoredTarget & { kind: Kind })[],
): string {
  const extra = claimed
    .filter((c) => c.course === course && c.kind === kind)
    .map((c) => ({ name: c.lecture }) as Lecture)
  if (!extra.length) return suggestName(courses, course, kind)
  const augmented = courses.map((c) => {
    if (c.name !== course) return c
    return kind === 'recitation'
      ? { ...c, recitations: [...(c.recitations ?? []), ...extra] }
      : { ...c, lectures: [...c.lectures, ...extra] }
  })
  return suggestName(augmented, course, kind)
}
