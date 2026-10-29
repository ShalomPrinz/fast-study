import type { AssignmentFile, Course, Kind, Lecture, MaterialInfo } from '@/types'
import { holdsFile } from '@/features/lectures/utils/lectureProgress'
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

// The course's assignment names — the assignment row's dropdown options.
export function existingAssignmentNames(courses: Course[], course: string): string[] {
  return (courses.find((c) => c.name === course)?.assignments ?? []).map((a) => a.name)
}

// The files already in the assignment named `name`, [] if it has none or doesn't exist.
export function assignmentFilesOf(
  name: string,
  courses: Course[],
  course: string,
): AssignmentFile[] {
  return (
    courses.find((c) => c.name === course)?.assignments?.find((a) => a.name === name)?.files ?? []
  )
}

// True when `name` is an existing assignment of the course that the user marked done.
export function isAssignmentDone(name: string, courses: Course[], course: string): boolean {
  return (
    courses.find((c) => c.name === course)?.assignments?.find((a) => a.name === name)?.done ?? false
  )
}

// The course's lectures and recitations, whichever kind a row would save as.
function allNodes(courses: Course[], course: string): Lecture[] {
  const node = courses.find((c) => c.name === course)
  return [...(node?.lectures ?? []), ...(node?.recitations ?? [])]
}

// Whether a stored video came from this discovery row, whatever its lecture is called now. A removed
// video keeps its source, so it still counts.
export function videoSourceHeld(ref: string, courses: Course[], course: string): boolean {
  return allNodes(courses, course).some((l) => l.videoSource === ref)
}

// The single "already on disk" rule for the green row, bulk skip and landed check; a material matches by
// `source === ref`, so several share a node. A video matches its stored source first, then the lecture
// name. An unprobed 'unknown' or 'unsupported' row is always false.
export function hasResource(
  item: { ref?: string; media: Media; resolvedMedia?: Media | ResolvedMedia },
  name: string,
  kind: Kind,
  courses: Course[],
  course: string,
): boolean {
  const media = item.resolvedMedia ?? item.media
  if (media === 'material') {
    const { ref } = item
    // A ref-less caller (a manual download) or a source-less material never matches.
    return (
      ref !== undefined && materialsOf(name, kind, courses, course).some((m) => m.source === ref)
    )
  }
  if (media === 'assignment') {
    const { ref } = item
    // `name` is the assignment; `kind` means nothing to it. Several files share one assignment.
    return (
      ref !== undefined && assignmentFilesOf(name, courses, course).some((f) => f.source === ref)
    )
  }
  if (media !== 'video') return false
  if (item.ref !== undefined && videoSourceHeld(item.ref, courses, course)) return true
  return holdsVideo(name, kind, courses, course)
}

// A removed video is still held: the lecture was finished from it, so re-downloading is a
// deliberate replace, not a gap to fill.
export function holdsVideo(name: string, kind: Kind, courses: Course[], course: string): boolean {
  const node = existingNodes(kind, courses, course).find((l) => l.name === name)
  return node ? holdsFile(node, 'video.mp4') : false
}

// Whether downloading this row could replace a stored video — the overwrite confirm's and the bulk
// skip's rule. Unlike `hasResource` an unprobed 'unknown' counts: it may be a video, and a video PUT
// wipes the lecture's transcript and summary.
export function overwritesVideo(
  item: { media: Media; resolvedMedia?: Media | ResolvedMedia },
  name: string,
  kind: Kind,
  courses: Course[],
  course: string,
): boolean {
  const media = item.resolvedMedia ?? item.media
  if (media === 'material' || media === 'assignment' || media === 'unsupported') return false
  return holdsVideo(name, kind, courses, course)
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
  target: { ref: string; name: string; kind: Kind; media: Media | 'unsupported' },
  courses: Course[],
  course: string,
): boolean {
  const { name, kind } = target
  // An unprobed 'unknown' target has no reliable on-disk target, so it never claims to have landed.
  if (target.media === 'unknown') return false
  // The target's recorded media is already the probe's answer, so it goes in as `resolvedMedia`.
  const item = { ref: target.ref, media: 'unknown' as const, resolvedMedia: target.media }
  // Every candidate goes through `hasResource`'s one rule — a sibling must hold the media itself, or a
  // bare node left by an earlier run reads as landed on a row the queue's own skip would not skip.
  // An assignment never splits, so only its own name can hold the file.
  const candidates = target.media === 'assignment' ? [name] : [name, `${name}.1`, `${name}.2`]
  return candidates.some((n) => hasResource(item, n, kind, courses, course))
}
