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

// Lectures always first: "Lectures 2-9, Recitations 1-4".
export function formatRange(entry: OverviewMeta[string]): string {
  return `${lecturePart(entry.lectures)}, ${recitationPart(entry.recitations)}`
}
