import { t } from '@lingui/core/macro'
import type { OverviewMeta, OverviewRange } from '@/types'

// "Lectures 2-9" / "Lecture 2" / "No Lectures", by range. Spelled out per kind rather than
// derived from a singular, since no locale pluralises by appending a letter.
function lecturePart(range: OverviewRange): string {
  if (!range) return t`No Lectures`
  if (range.start === range.end) return t`Lecture ${range.start}`
  return t`Lectures ${range.start}-${range.end}`
}

function recitationPart(range: OverviewRange): string {
  if (!range) return t`No Recitations`
  if (range.start === range.end) return t`Recitation ${range.start}`
  return t`Recitations ${range.start}-${range.end}`
}

// Natural order over dotted-number tokens, as the backend sorts them: "2.2" < "10", "2" < "2.1".
function compareToken(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return pa.length - pb.length
}

// One span over both ranges, for a course whose recitations count as lectures.
function combinedRange(a: OverviewRange, b: OverviewRange): OverviewRange {
  if (!a || !b) return a ?? b
  return {
    start: compareToken(a.start, b.start) <= 0 ? a.start : b.start,
    end: compareToken(a.end, b.end) >= 0 ? a.end : b.end,
  }
}

// Lectures always first: "Lectures 2-9, Recitations 1-4". A lectures-only course shows one
// lecture span covering both ranges, so meta written before the switch reads the same way.
export function formatRange(entry: OverviewMeta[string], lecturesOnly = false): string {
  if (lecturesOnly) return lecturePart(combinedRange(entry.lectures, entry.recitations))
  return `${lecturePart(entry.lectures)}, ${recitationPart(entry.recitations)}`
}
