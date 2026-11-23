import type { Course, Lecture } from '@/types'

function parts(course: Course | undefined): [string, Lecture][] {
  if (!course) return []
  return [
    ...course.lectures.map((l): [string, Lecture] => ['lecture', l]),
    ...course.recitations.map((l): [string, Lecture] => ['recitation', l]),
  ]
}

/** What the picker's headings come from: each part's name and `summary.md` mtime, so a part appearing, vanishing, renamed or rewritten changes it. */
export function headingsKey(course: Course | undefined): string {
  return parts(course)
    .map(([kind, l]) => `${kind}:${l.name}:${l.files['summary.md']?.mtime ?? '-'}`)
    .join('|')
}
