import type { Kind } from '@/types'
import { assignmentRoute, courseRoute, mergedNewRoute, mergedRoute } from '@/shared/utils/url'

export interface OpenPage {
  selected: { course: string; lecture: string; kind: Kind } | null
  overviewOpen: boolean
  openAssignment: string | null
  mergedOpen: boolean
  mergedNewOpen: boolean
}

export type FollowTarget =
  { type: 'lecture'; lecture: string; kind: Kind } | { type: 'path'; to: string } | null

// Where the open page goes once `course` is renamed to `effective`; null when none of this course's pages is open.
export function renameFollowTarget(
  course: string,
  effective: string,
  page: OpenPage,
): FollowTarget {
  const { selected } = page
  if (selected?.course === course) {
    return { type: 'lecture', lecture: selected.lecture, kind: selected.kind }
  }
  if (page.overviewOpen) return { type: 'path', to: courseRoute(effective) }
  if (page.openAssignment !== null) {
    return { type: 'path', to: assignmentRoute(effective, page.openAssignment) }
  }
  if (page.mergedOpen) return { type: 'path', to: mergedRoute(effective) }
  if (page.mergedNewOpen) return { type: 'path', to: mergedNewRoute(effective) }
  return null
}
