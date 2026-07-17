import type { Course, Kind } from '@/types'
import { suggestName } from '@/features/lectures/utils/namingSuggestion'

// Derive a lecture/recitation name from a recording title: pull the
// first integer out of the recording title → "Lecture N" / "Recitation N" by kind.
// When the title has no number, fall back to the tree's next-number suggestion.
//   ('הרצאה 3', 'lecture')    -> 'Lecture 3'
//   ('רועי', 'recitation')    -> suggestName(...) e.g. 'Recitation 4'
export function suggestItemName(
  title: string,
  kind: Kind,
  courses: Course[],
  course: string,
): string {
  const m = String(title ?? '').match(/\d+/)
  if (m) {
    const prefix = kind === 'recitation' ? 'Recitation' : 'Lecture'
    return `${prefix} ${parseInt(m[0], 10)}`
  }
  return suggestName(courses, course, kind)
}
