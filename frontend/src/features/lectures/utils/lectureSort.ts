// "Lecture 3" / "Lecture 1.2" / "Recitation 5" — group 1 = number, group 2 = sub-number.
const PATTERN = /^(?:Lecture|Recitation)\s+(\d+)(?:\.(\d+))?$/i

interface Parsed { n: number; sub: number }

function parse(name: string): Parsed | null {
  const m = name.match(PATTERN)
  return m ? { n: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 } : null
}

function compareLectureNames(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (pa && pb) return pa.n - pb.n || pa.sub - pb.sub
  // Unparsed names sort to the head.
  if (pa) return 1
  if (pb) return -1
  return a.localeCompare(b)
}

export function sortLectures<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareLectureNames(a.name, b.name))
}
