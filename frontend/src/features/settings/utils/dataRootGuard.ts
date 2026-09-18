import type { RunnerStatus } from '@/types'
import type { SettingsPatch } from '@/services/settings'

/** The runs a `DATA_ROOT` change would split across two roots. `null` means no warning; a list —
 *  empty while the runner sweeps with nothing in flight — raises the advisory confirm. */
export function runsAtRisk(patch: SettingsPatch, status: RunnerStatus | null): string[] | null {
  if (patch.dataRoot === undefined) return null
  const running = status?.runner.running ?? false
  const inFlight = status?.inFlight ?? []
  if (!running && inFlight.length === 0) return null
  return inFlight.map((entry) => `${entry.course} / ${entry.lecture}`)
}
