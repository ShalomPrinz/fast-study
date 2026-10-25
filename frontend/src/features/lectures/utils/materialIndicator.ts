import { t, plural } from '@lingui/core/macro'
import type { MaterialInfo } from '@/types'
import {
  attachedMaterials,
  attachmentsChanged,
  displayName,
  type SupportedExtensions,
} from './materials'

export type MaterialIndicatorState = { text: string; cls: string }

// How the attached materials relate to the summary; exact with the summarize record, else an mtime
// heuristic (docs/LECTURES.md). One material is named, several counted, as whole Hebrew sentences.
export function materialIndicator(
  materials: MaterialInfo[],
  summaryExists: boolean,
  summaryMtime: number | null,
  summaryMaterials: string[] | null,
  supported: SupportedExtensions,
): MaterialIndicatorState | null {
  const attached = attachedMaterials(materials, supported)
  const count = attached.length
  const name = count === 1 ? displayName(attached[0]) : ''

  if (!summaryExists) {
    if (materials.length === 0)
      return { text: t`no material found`, cls: 'material-indicator--missing' }
    if (count === 0)
      return { text: t`no material will be sent`, cls: 'material-indicator--missing' }
    return {
      text:
        count === 1
          ? t`summary with ${name}`
          : plural(count, { other: 'summary with # materials' }),
      cls: 'material-indicator--will-use',
    }
  }

  if (summaryMaterials && attachmentsChanged(summaryMaterials, materials, supported))
    return {
      text: t`Attachments changed since the summary`,
      cls: 'material-indicator--changed',
    }

  if (count === 0) return null

  const used = summaryMaterials
    ? count
    : summaryMtime === null
      ? 0
      : attached.filter((m) => m.mtime <= summaryMtime).length

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
