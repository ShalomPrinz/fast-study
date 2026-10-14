import type { RowLock } from '../contexts/RowEditsContext'
import type { RunTarget } from '../services/downloadServer'

// Starts a section run and, only once the server accepts it, pins each queued row's name — a refused
// run downloads nothing, so its rows keep following the suggestion.
export async function startAndLock<T>(
  start: () => Promise<T>,
  targets: readonly RunTarget[],
  course: string,
  lock: (ref: string, lock: RowLock) => void,
): Promise<T> {
  const result = await start()
  for (const t of targets)
    if (t.disposition === 'pending') lock(t.ref, { course, name: t.name, kind: t.kind })
  return result
}
