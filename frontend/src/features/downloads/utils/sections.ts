import { t } from '@lingui/core/macro'
import type { Item, Media } from '../services/autoDownloader'

// Items whose Moodle heading is blank still need a home.
export const OTHER_SECTION = 'Other'

// The synthetic bucket holding every video the keyword hint says is not a lecture recording. Not a
// Moodle heading — a real one spelled the same is a different section, told apart by `synthetic`.
export const OTHER_VIDEOS_SECTION = 'Other Videos'

// One rendered group of rows. `synthetic` marks the leftover pile: it spans every heading in the
// course, so it is not a section the server can run and it carries no localized Moodle title.
export interface Section {
  title: string
  items: Item[]
  synthetic: boolean
}

// A section heading for display. The sentinel is a run key, so it is translated here at render time
// and never at its definition — translating it there would make every run key locale-dependent.
export function sectionTitle(title: string): string {
  return title === OTHER_SECTION ? t`Other` : title
}

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
// nothing on this side is absent rather than empty. On the Videos side only, a row the keyword hint
// says is not a recording (a random course YouTube link) is pulled out of its heading into the
// synthetic bucket last — visible, but out of the lecture sections.
export function groupSections(items: Item[], media: Media): Section[] {
  const map = new Map<string, Item[]>()
  const strays: Item[] = []
  for (const item of items) {
    if (item.media !== media) continue
    if (media === 'video' && item.likelyRecording === false) {
      strays.push(item)
      continue
    }
    const key = item.section || OTHER_SECTION
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  const sections = [...map].map(([title, sectionItems]) => ({
    title,
    items: sectionItems,
    synthetic: false,
  }))
  if (strays.length) sections.push({ title: OTHER_VIDEOS_SECTION, items: strays, synthetic: true })
  return sections
}
