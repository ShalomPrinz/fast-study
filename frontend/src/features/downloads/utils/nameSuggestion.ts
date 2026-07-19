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

// The bulk path can't use per-row name edits, so it asks for the suggested name and
// whether that name already exists in one call — keeping its skip rule identical to a row's.
export function suggestedDownload(
  title: string,
  kind: Kind,
  courses: Course[],
  course: string,
): { name: string; alreadyDownloaded: boolean } {
  const name = suggestItemName(title, kind, courses, course)
  return { name, alreadyDownloaded: isDownloaded(name, kind, courses, course) }
}
