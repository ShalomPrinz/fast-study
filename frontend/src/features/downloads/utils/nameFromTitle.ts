import type { Course, Kind } from '@/types'
import { fallbackPrefix, sessionPrefix, suggestName } from '@/features/lectures/utils/nextName'

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

// First integer in the title → "<prefix> N", plus any sub-marker as a decimal. The prefix is the
// course's own, so a Hebrew course keeps naming in Hebrew; the UI locale's word is the fallback.
// No number at all falls back to the tree's next-number suggestion.
//   'הרצאה 3' -> 'הרצאה 3'   'הרצאה 11a' -> 'הרצאה 11.1'   'רועי' -> 'תרגול 4'
export function suggestItemName(
  title: string,
  kind: Kind,
  courses: Course[],
  course: string,
): string {
  const text = String(title ?? '')
  const m = text.match(/\d+/)
  if (m) {
    const prefix = sessionPrefix(courses, course, kind) ?? fallbackPrefix(kind)
    const number = parseInt(m[0], 10)
    const sub = subNumber(text.slice(m.index! + m[0].length))
    return sub === null ? `${prefix} ${number}` : `${prefix} ${number}.${sub}`
  }
  return suggestName(courses, course, kind)
}
