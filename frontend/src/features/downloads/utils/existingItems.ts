import type { Course, Kind, Lecture, MaterialInfo } from '@/types'
import type { Media } from '../services/autoDownloader'

// The live tree's nodes for one course+kind
function existingNodes(kind: Kind, courses: Course[], course: string): Lecture[] {
  const node = courses.find((c) => c.name === course)
  return (kind === 'recitation' ? node?.recitations : node?.lectures) ?? []
}

// The live tree's node names for one course+kind — also the material row's dropdown options.
export function existingNames(kind: Kind, courses: Course[], course: string): string[] {
  return existingNodes(kind, courses, course).map((l) => l.name)
}

// The materials already attached to the node named `name`, [] if it has none or doesn't exist.
export function materialsOf(
  name: string,
  kind: Kind,
  courses: Course[],
  course: string,
): MaterialInfo[] {
  return existingNodes(kind, courses, course).find((l) => l.name === name)?.materials ?? []
}

// The single "already on disk" rule: the node named `name` exists and holds the media — a video.mp4
// for a video row, any material for a material row — so the green row and the bulk skip can't disagree.
export function hasResource(
  media: Media,
  name: string,
  kind: Kind,
  courses: Course[],
  course: string,
): boolean {
  if (media === 'material') return materialsOf(name, kind, courses, course).length > 0
  const node = existingNodes(kind, courses, course).find((l) => l.name === name)
  return node?.files['video.mp4']?.exists ?? false
}

// A recording might split lazily into `${name}.1`/`.2` during download; returns whichever split
// siblings already exist on disk, so a whole-row download can warn before overwriting them.
export function splitSiblings(
  name: string,
  kind: Kind,
  courses: Course[],
  course: string,
): string[] {
  const names = existingNames(kind, courses, course)
  return [`${name}.1`, `${name}.2`].filter((n) => names.includes(n))
}
