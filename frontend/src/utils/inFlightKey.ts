import type { Kind } from '@/types'

// Must mirror backend `_skey` in backend/runner.py — same delimiter, same order.
export function inFlightKey(course: string, lecture: string, kind: Kind) {
  return `${course}||${lecture}||${kind}`
}
