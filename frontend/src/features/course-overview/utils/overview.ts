import type { OverviewMeta, OverviewRange } from '@/types'

// Returns "Lectures 2-9" / "Lecture 2" / "No Lectures", decided by given range
function rangePart(range: OverviewRange, singular: string): string {
  const plural = singular + 's' // assumes all relevant pluralization is just adding "s"
  if (!range) return `No ${plural}`
  if (range.start === range.end) return `${singular} ${range.start}`
  return `${plural} ${range.start}-${range.end}`
}

// Lectures part always first: "Lectures 2-9, Recitations 1-4" / "Lectures 2-9, No Recitations".
export function formatRange(entry: OverviewMeta[string]): string {
  return `${rangePart(entry.lectures, 'Lecture')}, ${rangePart(entry.recitations, 'Recitation')}`
}
