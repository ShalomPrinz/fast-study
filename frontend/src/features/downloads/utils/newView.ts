import type { Course } from '@/types'
import type { Item, Media } from '../services/autoDownloader'
import { videoSourceHeld } from './existingItems'
import { groupSections } from './sections'

// The New view lists the four media in this order, one big header each.
export const MEDIA_ORDER: readonly Media[] = ['video', 'material', 'assignment', 'unknown']

// Whether a stored file already came from this discovery row, wherever it is filed — the New view's
// "downloaded", which must not flip while the user retypes the row's target name.
export function recognisedByRef(
  item: { ref: string; media: Media; resolvedMedia?: Item['resolvedMedia'] },
  courses: Course[],
  course: string,
): boolean {
  const node = courses.find((c) => c.name === course)
  if (!node) return false
  const media = item.resolvedMedia ?? item.media
  const { ref } = item
  if (media === 'material')
    return [...node.lectures, ...node.recitations].some((l) =>
      l.materials.some((m) => m.source === ref),
    )
  if (media === 'assignment')
    return (node.assignments ?? []).some((a) => a.files.some((f) => f.source === ref))
  if (media === 'video') return videoSourceHeld(ref, courses, course)
  return false
}

// Whether any listed item is already recognised by ref, for the first-load prompt.
export function anyRecognised(items: Item[], courses: Course[], course: string): boolean {
  return items.some((i) => recognisedByRef(i, courses, course))
}

// The prompt shows for a fresh course only: no skips, nothing recognised, something to skip, and not
// dismissed for this load.
export function showsSkipBanner(args: {
  skipped: readonly string[]
  recognised: boolean
  newCount: number
  dismissed: boolean
}): boolean {
  return !args.dismissed && args.skipped.length === 0 && !args.recognised && args.newCount > 0
}

// One line of the New list: a selectable row, or a playlist's expand-only header.
export interface NewEntry {
  item: Item
  playlist: boolean
}

export interface NewSection {
  title: string
  synthetic: boolean
  entries: NewEntry[]
}

export interface NewGroup {
  media: Media
  sections: NewSection[]
}

export interface NewViewInput {
  skipped: ReadonlySet<string>
  // Whether the row is already in the course; the caller owns the name it asks under.
  isDone: (item: Item) => boolean
  // A row a run or a download is working on stays listed however far along it is.
  engaged: (ref: string) => boolean
  // An expanded playlist's children, null while collapsed or unfetched.
  childrenOf: (ref: string) => Item[] | null
}

function listed(item: Item, input: NewViewInput): boolean {
  if (input.skipped.has(item.ref)) return false
  if (item.expandable) return true
  return input.engaged(item.ref) || !input.isDone(item)
}

// The rows to approve, grouped media then Moodle section as the All view groups them. A playlist
// stays a header until expanded, then its listed children follow it in its section.
export function buildNewView(items: Item[], input: NewViewInput): NewGroup[] {
  const entriesOf = (item: Item): NewEntry[] => {
    if (!listed(item, input)) return []
    if (!item.expandable) return [{ item, playlist: false }]
    const children = (input.childrenOf(item.ref) ?? []).filter((c) => listed(c, input))
    return [
      { item, playlist: true },
      ...children.map((child) => ({ item: child, playlist: false })),
    ]
  }
  const groups: NewGroup[] = []
  for (const media of MEDIA_ORDER) {
    const sections = groupSections(items, media)
      .map((s) => ({
        title: s.title,
        synthetic: s.synthetic,
        entries: s.items.flatMap(entriesOf),
      }))
      .filter((s) => s.entries.length > 0)
    if (sections.length) groups.push({ media, sections })
  }
  return groups
}

// What a header counts: the rows to approve, plus a playlist that has not shown its rows yet.
export function entryCount(
  entries: readonly NewEntry[],
  childrenOf: (ref: string) => unknown,
): number {
  return entries.filter((e) => !e.playlist || !childrenOf(e.item.ref)).length
}

// Every selectable row on screen, in on-screen order.
export function selectableRefs(groups: readonly NewGroup[]): string[] {
  return groups.flatMap((g) =>
    g.sections.flatMap((s) => s.entries.filter((e) => !e.playlist).map((e) => e.item.ref)),
  )
}

// A row counts as checked unless unchecked: all start checked, and rows that appear later (an expanded
// playlist's children) do too.
export function checkedRefs(
  refs: readonly string[],
  unchecked: ReadonlySet<string>,
  engaged: (ref: string) => boolean,
): string[] {
  return refs.filter((ref) => !unchecked.has(ref) && !engaged(ref))
}

// The state of a section's select-all box over its selectable, not-engaged rows.
export function sectionCheck(
  refs: readonly string[],
  unchecked: ReadonlySet<string>,
  engaged: (ref: string) => boolean,
): 'all' | 'some' | 'none' {
  const free = refs.filter((r) => !engaged(r))
  const on = free.filter((r) => !unchecked.has(r)).length
  return on === 0 ? 'none' : on === free.length ? 'all' : 'some'
}

// The unchecked set after a section's select-all is clicked: everything on unless it all already is.
export function toggleSection(
  refs: readonly string[],
  unchecked: ReadonlySet<string>,
  engaged: (ref: string) => boolean,
): Set<string> {
  const next = new Set(unchecked)
  const free = refs.filter((r) => !engaged(r))
  if (sectionCheck(refs, unchecked, engaged) === 'all') for (const r of free) next.add(r)
  else for (const r of free) next.delete(r)
  return next
}

// What Skip all marks: every entry on screen, a playlist's own ref included, minus rows a run holds.
export function skippableRefs(
  groups: readonly NewGroup[],
  engaged: (ref: string) => boolean,
): string[] {
  return groups.flatMap((g) =>
    g.sections.flatMap((s) => s.entries.map((e) => e.item.ref).filter((r) => !engaged(r))),
  )
}

// Whether "Download selected" is held by the Moodle lock. A course run that is still running or
// paused holds that lock itself and the server appends to it, so a submit to it is never gated.
export function courseSubmitGated(args: {
  hasMoodleRow: boolean
  locked: boolean
  appending: boolean
}): boolean {
  return args.hasMoodleRow && args.locked && !args.appending
}
