import type { Kind } from '@/types'
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

// A lectures-only course's one list: by number, a lecture before a recitation on the same number
// (Lecture 1, Recitation 1, Lecture 2), then sub; names with no number sort by name after them.
export function compareMerged(
  a: { name: string; kind: Kind },
  b: { name: string; kind: Kind },
): number {
  const pa = parse(a.name)
  const pb = parse(b.name)
  const rank = (kind: Kind) => (kind === 'lecture' ? 0 : 1)
  if (pa && pb) {
    return (
      pa.n - pb.n || rank(a.kind) - rank(b.kind) || pa.sub - pb.sub || a.name.localeCompare(b.name)
    )
  }
  if (pa) return -1
  if (pb) return 1
  return a.name.localeCompare(b.name) || rank(a.kind) - rank(b.kind)
}
