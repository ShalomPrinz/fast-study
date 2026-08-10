import type { MaterialInfo } from '@/types'

export type MaterialIndicatorState = { symbol: string; text: string; cls: string }

// How the lecture's materials relate to its summary: none on disk, pending, all used, none used, or
// only some. Each material's mtime vs. the summary's is a heuristic for "was fed to the model" — see
// docs/LECTURES.md.
export function materialIndicator(
  materials: MaterialInfo[],
  summaryExists: boolean,
  summaryMtime: number | null,
): MaterialIndicatorState {
  const count = materials.length
  const label = count === 1 ? materials[0].name : `${count} materials`

  if (!summaryExists)
    return count
      ? { symbol: '📎', text: `${label} will be used`, cls: 'material-indicator--will-use' }
      : { symbol: '⚠', text: 'no material found', cls: 'material-indicator--missing' }

  if (count === 0)
    return {
      symbol: '⊘',
      text: 'summary did not use material',
      cls: 'material-indicator--was-missing',
    }

  const used = summaryMtime === null ? 0 : materials.filter((m) => m.mtime <= summaryMtime).length

  if (used === count)
    return {
      symbol: '📎',
      text: `${label} ${count > 1 ? 'were' : 'was'} used`,
      cls: 'material-indicator--used',
    }

  if (used === 0)
    return {
      symbol: '⊘',
      text: `summary did not use ${count === 1 ? label : 'any material'}`,
      cls: 'material-indicator--was-missing',
    }

  // A partial miss is milder than a total one, so it keeps the 📎 rather than the ⊘.
  return {
    symbol: '📎',
    text: `summary used only ${used} of ${count} materials`,
    cls: 'material-indicator--partial',
  }
}
