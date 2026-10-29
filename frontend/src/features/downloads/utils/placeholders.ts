import type { Kind } from '@/types'
import type { DownloadJob } from '../services/downloadServer'

// What a placeholder row needs of a course: the names it already lists.
interface TreeCourse {
  lectures: readonly { name: string }[]
  recitations?: readonly { name: string }[]
  lectures_only?: boolean
}

// Queued, running or `done`-but-not-yet-in-the-tree jobs of `courseName`; failed or cancelled leave none.
// A lectures-only course lists its recitations among the lectures, so that list takes both kinds.
export function placeholderJobs(
  snapshot: readonly DownloadJob[],
  courseName: string,
  tree: TreeCourse | undefined,
  list: Kind,
): DownloadJob[] {
  const has = (kind: Kind, name: string) =>
    (kind === 'recitation' ? (tree?.recitations ?? []) : (tree?.lectures ?? [])).some(
      (l) => l.name === name,
    )
  const seen = new Set<string>()
  return snapshot
    .filter((j) => {
      if (j.course !== courseName || !j.lecture) return false
      if (j.status === 'error' || j.status === 'cancelled') return false
      const shown = tree?.lectures_only ? list === 'lecture' : j.kind === list
      if (!shown || has(j.kind, j.lecture)) return false
      const key = `${j.kind}\0${j.lecture}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.lecture.localeCompare(b.lecture))
}
