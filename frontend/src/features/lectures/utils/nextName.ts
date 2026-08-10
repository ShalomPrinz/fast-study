import type { Course, Kind } from '@/types'

// Only canonical names order; a recitation has no sub-session form, so `Recitation 3.1` never parses.
const PATTERN: Record<Kind, RegExp> = {
  lecture: /^Lecture\s+(\d+)(?:\.(\d+))?$/i,
  recitation: /^Recitation\s+(\d+)$/i,
}

export interface LatestName {
  name: string
  n: number
  sub: number
}

// The newest canonical name in a list — highest number, then highest sub. Array order is ignored,
// so the frontend and the extension popup agree on what "latest" means. Null when none parse.
export function latestName(names: string[], kind: Kind): LatestName | null {
  const parsed = names
    .map((name) => {
      const m = name.match(PATTERN[kind])
      return m ? { name, n: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 } : null
    })
    .filter((x): x is LatestName => x !== null)
  if (!parsed.length) return null
  return parsed.reduce((a, b) => (a.n > b.n || (a.n === b.n && a.sub > b.sub) ? a : b))
}

function suggestLectureName(courses: Course[], courseName: string): string {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return ''
  const latest = latestName(
    course.lectures.map((l) => l.name),
    'lecture',
  )
  if (!latest) return 'Lecture 1'
  if (latest.sub === 0) return `Lecture ${latest.n + 1}`
  if (latest.sub === 1) return `Lecture ${latest.n}.2`
  return `Lecture ${latest.n + 1}`
}

function suggestRecitationName(courses: Course[], courseName: string): string {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return 'Recitation 1'
  const latest = latestName(
    (course.recitations ?? []).map((l) => l.name),
    'recitation',
  )
  return latest ? `Recitation ${latest.n + 1}` : 'Recitation 1'
}

export function suggestName(courses: Course[], courseName: string, kind: Kind): string {
  return kind === 'recitation'
    ? suggestRecitationName(courses, courseName)
    : suggestLectureName(courses, courseName)
}
