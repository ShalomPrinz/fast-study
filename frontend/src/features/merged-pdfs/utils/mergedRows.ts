import type { MergedPdf, RunError, RunnerStatus } from '@/types'
import { inFlightKey, parseInFlightKey } from '@/shared/utils/inFlightKey'

/** Where a merged PDF's run stands: another merge of the course holds the lock (`waiting`), it is `running`, or it `failed`. */
export type MergedRun =
  | { state: 'idle' }
  | { state: 'waiting' }
  | { state: 'running'; startedAt: string; size: number | null }
  | { state: 'failed'; error: RunError }

/** One history row; `item` is null for a first creation, which has no stored entry yet and is known by its file name only. */
export interface MergedRow {
  name: string
  item: MergedPdf | null
  run: MergedRun
}

function runOf(status: RunnerStatus | null, course: string, name: string): MergedRun {
  const key = inFlightKey(course, name, 'merged')
  // A running entry outranks the error of the attempt before it: the backend clears that error only once the run ends.
  const live = status?.inFlight.find((e) => inFlightKey(e.course, e.lecture, e.kind) === key)
  if (live)
    return live.waiting
      ? { state: 'waiting' }
      : { state: 'running', startedAt: live.startedAt, size: live.size ?? null }
  const error = status?.errors[key]
  return error ? { state: 'failed', error } : { state: 'idle' }
}

/** The rows of a course's history: runs with no stored entry yet first (they are the newest), then the stored entries newest first as given. */
export function mergedRows(
  course: string,
  items: MergedPdf[],
  status: RunnerStatus | null,
): MergedRow[] {
  const stored = new Set(items.map((i) => i.name))
  const fresh: string[] = []
  const keys = [
    ...(status?.inFlight ?? []).map((e) => inFlightKey(e.course, e.lecture, e.kind)),
    ...Object.keys(status?.errors ?? {}),
  ]
  for (const key of keys) {
    const id = parseInFlightKey(key)
    if (id?.kind !== 'merged' || id.course !== course) continue
    if (!stored.has(id.lecture) && !fresh.includes(id.lecture)) fresh.push(id.lecture)
  }
  return [
    ...fresh.map((name) => ({ name, item: null, run: runOf(status, course, name) })),
    ...items.map((item) => ({ name: item.name, item, run: runOf(status, course, item.name) })),
  ]
}
