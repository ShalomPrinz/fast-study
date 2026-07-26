import type { Course, Kind } from '@/types'
import { suggestName } from '@/features/lectures/utils/namingSuggestion'

const HEBREW_SUB = 'אבגדהוזחטי' // ordered, א -> 1 … י -> 10; later letters and final forms don't count

// A split session's part marker: one char glued to the number (optionally after `.`/`-`/`_`).
// Ambiguity is ignored rather than guessed, so the plain number wins.
//   '11a' / '11.A' / '11-א' / '11_3'  -> 1 / 1 / 1 / 3
//   '11 A' / '11ab' / '11.3.2024'     -> null  (whitespace, second letter, date tail)
function subNumber(rest: string): number | null {
  const m = rest.match(/^[.\-_]?([A-Za-zא-ת\d])'?(.{0,2})/)
  if (!m) return null
  const [, marker, tail] = m
  if (/^[A-Za-zא-ת\d]/.test(tail)) return null // a second letter/digit means it isn't a sub marker
  if (/^\.\d/.test(tail)) return null // '11.3.2024' is a date, not lecture 11.3
  if (/\d/.test(marker)) return parseInt(marker, 10)
  if (/[A-Za-z]/.test(marker)) return marker.toLowerCase().charCodeAt(0) - 96
  const index = HEBREW_SUB.indexOf(marker)
  return index < 0 ? null : index + 1
}

// First integer in the title → "Lecture N" / "Recitation N", plus any sub-marker as a decimal.
// No number at all falls back to the tree's next-number suggestion.
//   'הרצאה 3' -> 'Lecture 3'   'הרצאה 11a' -> 'Lecture 11.1'   'רועי' -> 'Recitation 4'
export function suggestItemName(
  title: string,
  kind: Kind,
  courses: Course[],
  course: string,
): string {
  const text = String(title ?? '')
  const m = text.match(/\d+/)
  if (m) {
    const prefix = kind === 'recitation' ? 'Recitation' : 'Lecture'
    const number = parseInt(m[0], 10)
    const sub = subNumber(text.slice(m.index! + m[0].length))
    return sub === null ? `${prefix} ${number}` : `${prefix} ${number}.${sub}`
  }
  return suggestName(courses, course, kind)
}

// The live tree's node names for one course+kind
function existingNames(kind: Kind, courses: Course[], course: string): string[] {
  const node = courses.find((c) => c.name === course)
  const existing = kind === 'recitation' ? node?.recitations : node?.lectures
  return existing?.map((l) => l.name) ?? []
}

// The single "already on disk" rule — exact name match in the live tree
export function isDownloaded(name: string, kind: Kind, courses: Course[], course: string): boolean {
  return existingNames(kind, courses, course).includes(name)
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
