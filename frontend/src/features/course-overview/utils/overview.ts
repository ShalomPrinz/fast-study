import type { OverviewMeta, OverviewRange } from '@/types'

// "Lectures 2-9" / "Lecture 2" / "No Lectures", by range.
function rangePart(range: OverviewRange, singular: string): string {
  const plural = singular + 's' // assumes all relevant pluralization is just adding "s"
  if (!range) return `No ${plural}`
  if (range.start === range.end) return `${singular} ${range.start}`
  return `${plural} ${range.start}-${range.end}`
}

// Lectures always first: "Lectures 2-9, Recitations 1-4".
export function formatRange(entry: OverviewMeta[string]): string {
  return `${rangePart(entry.lectures, 'Lecture')}, ${rangePart(entry.recitations, 'Recitation')}`
}
