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

// A "part N" / "חלק N" marker: the decimal of a keyword-numbered session, never the session number itself.
const PART_NUMBER = /(?<![A-Za-zא-ת])(?:part|חלק)[\s#:.\-–]*(\d+)(?!\d)/i

// Title's first integer plus sub-marker -> 'הרצאה 11.1', else the section's keyword number, else the next name.
// A part marker becomes the decimal of a keyword number, title's else section's. `prefixKind` overrides the kind.
export function suggestItemName(
  title: string,
  kind: Kind,
  courses: Course[],
  course: string,
  prefixKind: Kind = kind,
  section = '',
): string {
  const raw = String(title ?? '')
  const heading = String(section ?? '')
  const part = raw.match(PART_NUMBER)
  if (part) {
    const base = raw.match(SECTION_NUMBER) ?? heading.match(SECTION_NUMBER)
    if (base) {
      const prefix = sessionPrefix(courses, course, prefixKind) ?? fallbackPrefix(prefixKind)
      const rest = base.input!.slice(base.index! + base[0].length)
      const own = /^\s*[-–]\s*\d/.test(rest) ? null : subNumber(rest)
      const number = parseInt(base[1], 10)
      // '11א חלק 2' has two sub-markers; guessing which one wins would mislabel, so neither does.
      return own === null ? `${prefix} ${number}.${parseInt(part[1], 10)}` : `${prefix} ${number}`
    }
  }
  const text = part ? `${raw.slice(0, part.index)} ${raw.slice(part.index! + part[0].length)}` : raw
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
