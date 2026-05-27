import type { Kind } from '@/types'

export function kindSearch(kind: Kind | undefined): string {
  return kind === 'recitation' ? '?kind=recitation' : ''
}

export function lectureRoute(course: string, lecture: string, kind: Kind | undefined): string {
  return `/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}${kindSearch(kind)}`
}
