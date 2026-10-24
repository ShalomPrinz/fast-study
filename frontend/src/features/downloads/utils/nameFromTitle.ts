import type { Course, Kind } from '@/types'
import { fallbackPrefix, sessionPrefix, suggestName } from '@/features/lectures/utils/nextName'

const HEBREW_SUB = 'אבגדהוזחטי' // ordered, א -> 1 … י -> 10; later letters and final forms don't count

// A split session's part marker, one char glued to the number; ambiguity yields null.
//   '11a' / '11-א' / '11_3' -> 1 / 1 / 3    '11 A' / '11ab' / '11.3.2024' -> null
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

// A section heading counts only as "<lecture/recitation keyword> N"; date ranges and "שבוע 3" don't.
const SECTION_NUMBER =
  /(?:הרצאות|הרצאה|תרגולים|תרגול|תרגיל|lecture|recitation|tutorial|tirgul)[\s#:.\-–]*(\d+)(?![\d/])(?!\.\d)/i

// Title: first integer plus sub-marker -> 'הרצאה 11.1'. Numberless title: its section's keyword heading
// number (a range takes its first), else the tree's next name. `prefixKind` overrides the prefix's kind.
export function suggestItemName(
  title: string,
  kind: Kind,
  courses: Course[],
  course: string,
  prefixKind: Kind = kind,
  section = '',
): string {
  const text = String(title ?? '')
  const heading = String(section ?? '')
  const m = text.match(/\d+/)
  const hit = m ? null : heading.match(SECTION_NUMBER)
  const found = m ?? hit
  if (found) {
    const source = m ? text : heading
    const digits = m ? m[0] : hit![1]
    const end = m ? m.index! + m[0].length : hit!.index! + hit![0].length
    const prefix = sessionPrefix(courses, course, prefixKind) ?? fallbackPrefix(prefixKind)
    const rest = source.slice(end)
    const sub = !m && /^\s*[-–]\s*\d/.test(rest) ? null : subNumber(rest)
    const number = parseInt(digits, 10)
    return sub === null ? `${prefix} ${number}` : `${prefix} ${number}.${sub}`
  }
  return suggestName(courses, course, kind)
}
