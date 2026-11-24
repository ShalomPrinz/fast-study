import type { Topic } from '@/services/events'

// Which halves of a runner/tree refetch a notify's matched topics call for: `runner` the live state, `tree` the disk state.
export function refreshSides(matched: readonly Topic[]): { runner: boolean; tree: boolean } {
  return { runner: matched.includes('runner'), tree: matched.includes('tree') }
}
