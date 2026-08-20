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

// The prefix a course already uses for a kind, so a new name copies its language. Null when the
// course is unknown or nothing in it parses.
export function sessionPrefix(courses: Course[], courseName: string, kind: Kind): string | null {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return null
  const items = kind === 'recitation' ? (course.recitations ?? []) : course.lectures
  return (
    latestName(
      items.map((i) => i.name),
      kind,
    )?.prefix ?? null
  )
}

// The wording a course with nothing to copy falls back to. The `directory name` context keeps this
// msgid separate from the UI's `Lecture` / `Recitation` button copy: the two render the same word
// today, but this one becomes a directory under DATA_ROOT, and a translator shortening a button
// label to fit the segmented control must not rename directories.
export function fallbackPrefix(kind: Kind): string {
  return kind === 'recitation'
    ? t({ message: 'Recitation', context: 'directory name' })
    : t({ message: 'Lecture', context: 'directory name' })
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
  if (!latest) return `${fallbackPrefix('lecture')} 1`
  if (latest.sub === 1) return `${latest.prefix} ${latest.n}.2`
  return `${latest.prefix} ${latest.n + 1}`
}

function suggestRecitationName(courses: Course[], courseName: string): string {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return `${fallbackPrefix('recitation')} 1`
  const latest = latestName(
    (course.recitations ?? []).map((l) => l.name),
    'recitation',
  )
  return latest ? `${latest.prefix} ${latest.n + 1}` : `${fallbackPrefix('recitation')} 1`
}

export function suggestName(courses: Course[], courseName: string, kind: Kind): string {
  return kind === 'recitation'
    ? suggestRecitationName(courses, courseName)
    : suggestLectureName(courses, courseName)
}
