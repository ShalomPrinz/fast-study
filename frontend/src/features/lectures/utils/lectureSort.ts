import { PATTERN } from './nextName'

interface Parsed {
  n: number
  sub: number
}

// Any prefix, like nextName's suggestions: "Lecture 3", "הרצאה 1.2" — group 2 = number, 3 = sub.
function parse(name: string): Parsed | null {
  const m = name.match(PATTERN)
  return m ? { n: parseInt(m[2], 10), sub: m[3] ? parseInt(m[3], 10) : 0 } : null
}

function compareLectureNames(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (pa && pb) return pa.n - pb.n || pa.sub - pb.sub || a.localeCompare(b)
  // Unparsed names sort to the head.
  if (pa) return 1
  if (pb) return -1
  return a.localeCompare(b)
}

export function sortLectures<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareLectureNames(a.name, b.name))
}
