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

// The active course a typed name means, in its stored spelling; null makes it a new course. Case is
// ignored because NTFS folds it, so the database would refuse the new folder as taken.
export function matchCourse(active: readonly Course[], typed: string): string | null {
  const key = typed.trim().toLowerCase()
  return active.find((c) => c.name.toLowerCase() === key)?.name ?? null
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
// A course the tree lacks is a new one the download will create, so it starts empty.
export function suggestManualName(
  courses: Course[],
  course: string,
  kind: Kind,
  claimed: readonly (StoredTarget & { kind: Kind })[],
): string {
  const tree = courses.some((c) => c.name === course)
    ? courses
    : [
        ...courses,
        { name: course, archived: false, source_url: null, lectures: [], recitations: [] },
      ]
  const extra = claimed
    .filter((c) => c.course === course && c.kind === kind)
    .map((c) => ({ name: c.lecture }) as Lecture)
  if (!extra.length) return suggestName(tree, course, kind)
  const augmented = tree.map((c) => {
    if (c.name !== course) return c
    return kind === 'recitation'
      ? { ...c, recitations: [...(c.recitations ?? []), ...extra] }
      : { ...c, lectures: [...c.lectures, ...extra] }
  })
  return suggestName(augmented, course, kind)
}

// Whether a pasted link is on the configured Moodle site — auto's own test (same origin), so the form
// gates exactly the links auto routes through the Moodle lock. Unparseable or no site is not Moodle.
export function onMoodleSite(url: string, site: string | null | undefined): boolean {
  if (!site) return false
  try {
    return new URL(url.trim()).origin === new URL(site).origin
  } catch {
    return false
  }
}
