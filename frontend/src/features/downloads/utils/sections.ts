import type { Item, Media } from '../services/autoDownloader'

// Items whose Moodle heading is blank still need a home.
const OTHER_SECTION = 'Other'

const MEDIA: readonly string[] = ['video', 'material', 'unknown'] satisfies Media[]

// A section's run key. Course- and media-qualified: a bare title would hand a section another
// course's run state, or the video side's to the materials side.
export function sectionId(course: string, media: Media, title: string): string {
  return `${course}:${media}:${title}`
}

// The inverse. Course names are NTFS-sanitized on disk so they never hold a `:`, and the media is a
// known enum — so the first two colons delimit, and everything after the second is the title.
export function parseSectionId(id: string): { course: string; media: Media; title: string } | null {
  const first = id.indexOf(':')
  const second = id.indexOf(':', first + 1)
  if (first < 1 || second < 0) return null
  const media = id.slice(first + 1, second)
  const title = id.slice(second + 1)
  if (!MEDIA.includes(media) || !title) return null
  return { course: id.slice(0, first), media: media as Media, title }
}

// The active media's items, grouped by Moodle heading in first-seen order — so a section with
// nothing on this side is absent rather than empty.
export function groupSections(items: Item[], media: Media): [string, Item[]][] {
  const map = new Map<string, Item[]>()
  for (const item of items) {
    if (item.media !== media) continue
    const key = item.section || OTHER_SECTION
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  return [...map]
}
