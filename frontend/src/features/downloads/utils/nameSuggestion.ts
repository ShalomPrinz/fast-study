import type { Course, Kind } from '@/types'
import { suggestName } from '@/features/lectures/utils/namingSuggestion'

const HEBREW_SUB = 'אבגדהוזחטי' // ordered, א -> 1 … י -> 10; later letters and final forms don't count

// A split session marks its part with exactly one character glued to the number (no
// whitespace), optionally after a `.`/`-`/`_` separator: a Latin letter (a=1 … z=26), one
// of 'אבגדהוזחטי' (א=1 … י=10), or — separator required — a single digit. Anything longer
// or ambiguous is ignored rather than guessed, so the plain number wins.
//   '11a' / '11.A' / '11-א' -> 11.1      (also '11א'' — a trailing geresh is fine)
//   '11_3' / '11-2'         -> 11.3 / 11.2
//   '11 A' / '11 א'         -> 11        (whitespace breaks the pairing)
//   '11ab' / '11.3.2024'    -> 11        (second letter / date tail voids the marker)
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

// Derive a lecture/recitation name from a recording title: pull the first integer out
// of the recording title → "Lecture N" / "Recitation N" by kind, plus the sub-session
// marker glued to those digits (see subNumber) as a decimal sub-number.
// When the title has no number, fall back to the tree's next-number suggestion.
//   ('הרצאה 3', 'lecture')     -> 'Lecture 3'
//   ('הרצאה 11a', 'lecture')   -> 'Lecture 11.1'
//   ('רועי', 'recitation')     -> suggestName(...) e.g. 'Recitation 4'
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

// Single source of truth for "this recording is already on disk": an exact name match
// against the course's lectures (or recitations, per kind) in the live tree.
export function isDownloaded(
  name: string,
  kind: Kind,
  courses: Course[],
  course: string,
): boolean {
  const node = courses.find((c) => c.name === course)
  const existing = kind === 'recitation' ? node?.recitations : node?.lectures
  return existing?.some((l) => l.name === name) ?? false
}
