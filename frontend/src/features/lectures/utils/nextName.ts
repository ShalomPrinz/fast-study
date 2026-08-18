import { t } from '@lingui/core/macro'
import type { Course, Kind } from '@/types'

// Any prefix followed by a number, so a course names its sessions in whatever language it uses.
// A recitation has no sub-session form, so `תרגול 3.1` is rejected rather than parsed.
const PATTERN = /^(.+?)\s+(\d+)(?:\.(\d+))?$/

export interface LatestName {
  name: string
  prefix: string
  n: number
  sub: number
}

// The newest name in a list — highest number, then highest sub. Array order is ignored, so the
// frontend and the extension popup agree on what "latest" means. Null when none parse.
export function latestName(names: string[], kind: Kind): LatestName | null {
  const parsed = names
    .map((name) => {
      const m = name.match(PATTERN)
      if (!m) return null
      if (kind === 'recitation' && m[3]) return null
      return {
        name,
        prefix: m[1],
        n: parseInt(m[2], 10),
        sub: m[3] ? parseInt(m[3], 10) : 0,
      }
    })
    .filter((x): x is LatestName => x !== null)
  if (!parsed.length) return null
  return parsed.reduce((a, b) => (a.n > b.n || (a.n === b.n && a.sub > b.sub) ? a : b))
}

// These become directory names under DATA_ROOT, so they follow the course's own naming rather than
// any fixed language; only a course with nothing to copy falls back to the UI locale's wording.
function suggestLectureName(courses: Course[], courseName: string): string {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return ''
  const latest = latestName(
    course.lectures.map((l) => l.name),
    'lecture',
  )
  if (!latest) return t`Lecture 1`
  if (latest.sub === 1) return `${latest.prefix} ${latest.n}.2`
  return `${latest.prefix} ${latest.n + 1}`
}

function suggestRecitationName(courses: Course[], courseName: string): string {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return t`Recitation 1`
  const latest = latestName(
    (course.recitations ?? []).map((l) => l.name),
    'recitation',
  )
  return latest ? `${latest.prefix} ${latest.n + 1}` : t`Recitation 1`
}

export function suggestName(courses: Course[], courseName: string, kind: Kind): string {
  return kind === 'recitation'
    ? suggestRecitationName(courses, courseName)
    : suggestLectureName(courses, courseName)
}
