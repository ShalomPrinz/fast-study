import type { Item, Media } from '../services/autoDownloader'

// Items whose Moodle heading is blank still need a home.
const OTHER_SECTION = 'Other'

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
