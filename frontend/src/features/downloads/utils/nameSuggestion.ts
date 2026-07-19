import type { Course, Kind } from '@/types'
import { suggestName } from '@/features/lectures/utils/namingSuggestion'

// Derive a lecture/recitation name from a recording title: pull the first integer out
// of the recording title → "Lecture N" / "Recitation N" by kind. A single Latin letter
// glued to those digits marks a split session and becomes a decimal sub-number
// (a=1 … z=26); anything else about the letter is ignored rather than guessed.
// When the title has no number, fall back to the tree's next-number suggestion.
//   ('הרצאה 3', 'lecture')     -> 'Lecture 3'
//   ('הרצאה 11a', 'lecture')   -> 'Lecture 11.1'
//   ('הרצאה 11 A', 'lecture')  -> 'Lecture 11'    (space breaks the pairing)
//   ('רועי', 'recitation')     -> suggestName(...) e.g. 'Recitation 4'
export function suggestItemName(
  title: string,
  kind: Kind,
  courses: Course[],
  course: string,
): string {
  const m = String(title ?? '').match(/(\d+)([A-Za-z]*)/)
  if (m) {
    const prefix = kind === 'recitation' ? 'Recitation' : 'Lecture'
    const number = parseInt(m[1], 10)
    const letters = m[2]
    if (letters.length === 1) {
      const index = letters.toLowerCase().charCodeAt(0) - 96 // 'a' -> 1
      return `${prefix} ${number}.${index}`
    }
    return `${prefix} ${number}`
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
