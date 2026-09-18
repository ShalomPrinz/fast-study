import { t, plural } from '@lingui/core/macro'
import type { MaterialInfo } from '@/types'

export type MaterialIndicatorState = { text: string; cls: string }

// How the materials relate to the summary, by mtime — a heuristic, see docs/LECTURES.md. One material
// is named and several counted as whole sentences, since the Hebrew verb agrees with the subject.
export function materialIndicator(
  materials: MaterialInfo[],
  summaryExists: boolean,
  summaryMtime: number | null,
): MaterialIndicatorState {
  const count = materials.length
  const name = count === 1 ? materials[0].name : ''

  if (!summaryExists)
    return count
      ? {
          text:
            count === 1
              ? t`${name} will be used`
              : plural(count, { other: '# materials will be used' }),
          cls: 'material-indicator--will-use',
        }
      : { text: t`no material found`, cls: 'material-indicator--missing' }

  if (count === 0)
    return {
      text: t`summary did not use material`,
      cls: 'material-indicator--was-missing',
    }

  const used = summaryMtime === null ? 0 : materials.filter((m) => m.mtime <= summaryMtime).length

  if (used === count)
    return {
      text: count === 1 ? t`${name} was used` : plural(count, { other: '# materials were used' }),
      cls: 'material-indicator--used',
    }

  if (used === 0)
    return {
      text: count === 1 ? t`summary did not use ${name}` : t`summary did not use any material`,
      cls: 'material-indicator--was-missing',
    }

  // A partial miss gets its own state: milder than a total one, but not a clean success.
  return {
    text: plural(count, { other: `summary used only ${used} of # materials` }),
    cls: 'material-indicator--partial',
  }
}
