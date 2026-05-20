import type { Course, Kind } from '../types'

export function recitationGroupKey(courseName: string): string {
  return `${courseName}::recitations`
}

export function suggestLectureName(courses: Course[], courseName: string): string {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return ''
  const matches = course.lectures
    .map((l) => { const m = l.name.match(/^Lecture\s+(\d+)(?:\.(\d+))?$/i); return m ? { n: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 } : null })
    .filter((x): x is { n: number; sub: number } => x !== null)
  if (!matches.length) return 'Lecture 1'
  const latest = matches.reduce((a, b) => a.n > b.n || (a.n === b.n && a.sub > b.sub) ? a : b)
  if (latest.sub === 0) return `Lecture ${latest.n + 1}`
  if (latest.sub === 1) return `Lecture ${latest.n}.2`
  return `Lecture ${latest.n + 1}`
}

export function suggestRecitationName(courses: Course[], courseName: string): string {
  const course = courses.find((c) => c.name === courseName)
  if (!course) return 'Recitation 1'
  const nums = (course.recitations ?? [])
    .map((l) => { const m = l.name.match(/^Recitation\s+(\d+)$/i); return m ? parseInt(m[1], 10) : null })
    .filter((x): x is number => x !== null)
  if (!nums.length) return 'Recitation 1'
  return `Recitation ${Math.max(...nums) + 1}`
}

export function suggestName(courses: Course[], courseName: string, kind: Kind): string {
  return kind === 'recitation' ? suggestRecitationName(courses, courseName) : suggestLectureName(courses, courseName)
}
