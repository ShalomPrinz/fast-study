import type { Kind } from '@/types'
import type { DownloadJob } from '../services/downloadServer'

// What a placeholder row needs of a course: the names it already lists.
interface TreeCourse {
  lectures: readonly { name: string }[]
  recitations?: readonly { name: string }[]
  lectures_only?: boolean
  assignments?: readonly { name: string }[]
}

// A tree list a placeholder can land in: a lecture or recitation list, or the Assignments group.
export type PlaceholderList = Kind | 'assignment'

// Queued, running or `done`-but-not-yet-in-the-tree jobs of `courseName`; failed or cancelled leave none.
// A lectures-only course's lecture list takes both kinds; an assignment job lands only in its group.
export function placeholderJobs(
  snapshot: readonly DownloadJob[],
  courseName: string,
  tree: TreeCourse | undefined,
  list: PlaceholderList,
): DownloadJob[] {
  const listed = (j: DownloadJob) =>
    j.media === 'assignment'
      ? (tree?.assignments ?? [])
      : j.kind === 'recitation'
        ? (tree?.recitations ?? [])
        : (tree?.lectures ?? [])
  const seen = new Set<string>()
  return snapshot
    .filter((j) => {
      if (j.course !== courseName || !j.lecture) return false
      if (j.status === 'error' || j.status === 'cancelled') return false
      const shown =
        j.media === 'assignment'
          ? list === 'assignment'
          : tree?.lectures_only
            ? list === 'lecture'
            : j.kind === list
      if (!shown || listed(j).some((l) => l.name === j.lecture)) return false
      const key = `${j.media ?? j.kind}\0${j.lecture}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.lecture.localeCompare(b.lecture))
}
