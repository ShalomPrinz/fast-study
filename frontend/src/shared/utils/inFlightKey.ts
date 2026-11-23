import type { StatusKind } from '@/types'

const STATUS_KINDS: string[] = ['lecture', 'recitation', 'assignment', 'merged']

// Must mirror backend `_skey` in backend/pipeline/runner.py — same delimiter, same order.
export function inFlightKey(course: string, lecture: string, kind: StatusKind) {
  return `${course}||${lecture}||${kind}`
}

// The inverse of `inFlightKey`; null for a key that is not one (the runner's `runner-crash`).
export function parseInFlightKey(
  key: string,
): { course: string; lecture: string; kind: StatusKind } | null {
  const parts = key.split('||')
  if (parts.length !== 3) return null
  const [course, lecture, kind] = parts
  if (!STATUS_KINDS.includes(kind)) return null
  return { course, lecture, kind: kind as StatusKind }
}
