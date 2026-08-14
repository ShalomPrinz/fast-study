import type { Course, Kind, Lecture, MaterialInfo } from '@/types'
import type { Media, ResolvedMedia } from '../services/autoDownloader'

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
// The probe's answer wins over the listed media; an unprobed 'unknown' row (and an 'unsupported' one)
// has no reliable on-disk target, so it falls to false rather than ever claiming a false "downloaded".
export function hasResource(
  item: { media: Media; resolvedMedia?: ResolvedMedia },
  name: string,
  kind: Kind,
  courses: Course[],
  course: string,
): boolean {
  const media = item.resolvedMedia ?? item.media
  if (media === 'material') return materialsOf(name, kind, courses, course).length > 0
  if (media !== 'video') return false
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

// Whether a bulk-run target is on disk — the durable answer a run reads its outcome from. The split
// siblings count: a zoom share queued as `name` lands as `name.1`/`.2`, and nothing else would see it.
export function targetLanded(
  target: { name: string; kind: Kind; media: Media | 'unsupported' },
  courses: Course[],
  course: string,
): boolean {
  const { name, kind } = target
  // The target's recorded media is already the probe's answer, so it goes in as `resolvedMedia` —
  // which leaves an 'unknown' target (no reliable on-disk target) falling through to false.
  const item =
    target.media === 'unknown'
      ? { media: 'unknown' as const }
      : { media: 'unknown' as const, resolvedMedia: target.media }
  return (
    hasResource(item, name, kind, courses, course) ||
    splitSiblings(name, kind, courses, course).length > 0
  )
}
