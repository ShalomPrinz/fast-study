import type { MergedPart } from '@/types'

/** The router state "Re-create" hands the create page (`location.state`): a history row's title and its parts in merge order. */
export interface MergedPrefill {
  title: string
  parts: MergedPart[]
}
