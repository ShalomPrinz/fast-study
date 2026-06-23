// Matches all kinds in one pattern: "Lecture 3", "Lecture 1.2", "Recitation 5".
// Group 1 = main number, Group 2 = optional sub-number (e.g. ".2" in "1.2").
const PATTERN = /^(?:Lecture|Recitation)\s+(\d+)(?:\.(\d+))?$/i

interface Parsed { n: number; sub: number }

// Pull { n, sub } out of a name
function parse(name: string): Parsed | null {
  const m = name.match(PATTERN)
  return m ? { n: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 } : null
}

function compareLectureNames(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  // Both numbered: order by main number, falling back to sub-number on a tie.
  if (pa && pb) return pa.n - pb.n || pa.sub - pb.sub
  // Exactly one is numbered: the unmatched name sorts to the head
  if (pa) return 1
  if (pb) return -1
  // Neither matches: sort alphabetically
  return a.localeCompare(b)
}

// Returns a new sorted array
export function sortLectures<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareLectureNames(a.name, b.name))
}
