import type { RunKind } from '@/types'

// Must mirror backend `_skey` in backend/pipeline/runner.py — same delimiter, same order.
export function inFlightKey(course: string, lecture: string, kind: RunKind) {
  return `${course}||${lecture}||${kind}`
}

// The inverse of `inFlightKey`; null for a key that is not one (the runner's `runner-crash`).
export function parseInFlightKey(
  key: string,
): { course: string; lecture: string; kind: RunKind } | null {
  const parts = key.split('||')
  if (parts.length !== 3) return null
  const [course, lecture, kind] = parts
  if (kind !== 'lecture' && kind !== 'recitation' && kind !== 'assignment') return null
  return { course, lecture, kind }
}
