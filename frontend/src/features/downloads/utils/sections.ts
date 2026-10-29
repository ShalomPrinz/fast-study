import { t } from '@lingui/core/macro'
import type { Item, Media } from '../services/autoDownloader'

// Items whose Moodle heading is blank still need a home.
export const OTHER_SECTION = 'Other'

// The synthetic bucket holding every row the keyword hint says is not a lecture recording. Not a
// Moodle heading — a real one spelled the same is a different section, told apart by `synthetic`.
export const OTHER_LINKS_SECTION = 'Other Links'

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

const MEDIA: readonly string[] = ['video', 'material', 'assignment', 'unknown'] satisfies Media[]

// A section's run key. Course- and media-qualified: a bare title would hand a section another
// course's run state, or the video side's to the materials side.
export function sectionId(course: string, media: Media, title: string): string {
  return `${course}:${media}:${title}`
}

// The New view's course run key. A section key has two colons and a course name none, so this
// one-colon key can never equal one, and `parseSectionId` reads it as no section.
export function courseRunId(course: string): string {
  return `${course}:course`
}

// Joins a playlist's run key onto its section's: a control character no Moodle heading or ref carries,
// so a playlist key never collides with a section key and splits back unambiguously.
const PLAYLIST_SEP = '\u001f'

// A playlist's own run key, nested under its section's so the section can find the runs inside it.
export function playlistRunId(sectionKey: string, ref: string): string {
  return `${sectionKey}${PLAYLIST_SEP}${ref}`
}

// The section key a run key belongs to: itself for a section's run, the prefix for a playlist's.
export function runSectionKey(runKey: string): string {
  const sep = runKey.indexOf(PLAYLIST_SEP)
  return sep < 0 ? runKey : runKey.slice(0, sep)
}

// The inverse of a section key. Course names are NTFS-sanitized on disk so they never hold a `:`, and
// the media is a known enum — so the first two colons delimit, and everything after the second is the title.
export function parseSectionId(id: string): { course: string; media: Media; title: string } | null {
  const first = id.indexOf(':')
  const second = id.indexOf(':', first + 1)
  if (first < 1 || second < 0) return null
  const media = id.slice(first + 1, second)
  const title = id.slice(second + 1)
  if (!MEDIA.includes(media) || !title) return null
  return { course: id.slice(0, first), media: media as Media, title }
}

// The active media's items by Moodle heading, first-seen order; rows the keyword hint marks as not a
// recording go to the synthetic bucket, last. See docs/DOWNLOADS.md §Discovery.
export function groupSections(items: Item[], media: Media): Section[] {
  const map = new Map<string, Item[]>()
  const strays: Item[] = []
  for (const item of items) {
    if (item.media !== media) continue
    if (item.likelyRecording === false) {
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
  if (strays.length) sections.push({ title: OTHER_LINKS_SECTION, items: strays, synthetic: true })
  return sections
}

// How many downloads the section stands for: a playlist counts its children once expanded, and
// itself until then — "Download all" stays disabled in that window, so its count is exact when usable.
export function leafCount(items: Item[], childrenOf: (ref: string) => Item[] | null): number {
  return items.reduce(
    (n, item) => n + (item.expandable ? (childrenOf(item.ref)?.length ?? 1) : 1),
    0,
  )
}

// Unknown is the only segment hidden when empty: most courses have no Drive rows at all.
export function showsMediaSegment(media: Media, count: number): boolean {
  return media !== 'unknown' || count > 0
}

// Which kind of collapsible group a header heads, and the stable-selector prefix each one carries.
export type GroupScope = 'section' | 'playlist' | 'course'

export const GROUP_SELECTOR: Record<GroupScope, string> = {
  course: 'recordings-course',
  section: 'recordings-section',
  playlist: 'recording-playlist',
}
