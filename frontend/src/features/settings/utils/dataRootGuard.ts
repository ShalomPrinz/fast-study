import type { RunnerStatus } from '@/types'
import type { SettingsPatch } from '@/services/settings'

/** The runs a `DATA_ROOT` change would split across two roots — earlier steps written under the old
 *  root, later ones under the new. `null` means nothing to warn about; a list (possibly empty, when
 *  the runner is sweeping with nothing yet in flight) means raise the confirm. The check is
 *  advisory by design: the user is only ever told what is running, never blocked. */
export function runsAtRisk(patch: SettingsPatch, status: RunnerStatus | null): string[] | null {
  if (patch.dataRoot === undefined) return null
  const running = status?.runner.running ?? false
  const inFlight = status?.inFlight ?? []
  if (!running && inFlight.length === 0) return null
  return inFlight.map((entry) => `${entry.course} / ${entry.lecture}`)
}
