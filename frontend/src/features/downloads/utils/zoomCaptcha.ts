import { t } from '@lingui/core/macro'
import type { SectionRun } from '@/features/downloads/services/downloadServer'
import { toast } from '@/services/toaster'

// A `captchaSolved` this item's capture reported: says so briefly. The waiting banner follows the
// `/auth/events` flag alone, so a late answer never hides the next item's wait.
export function toastCaptchaSolved(captchaSolved: boolean | undefined): void {
  if (captchaSolved !== true) return
  toast('success', t`Caught the Zoom video. The download is in progress.`)
}

// Counts run targets that newly gained `captchaSolved`, keyed by run id + target index since every
// `/runs` resync repeats the flag. The first snapshot only seeds: a catch from before load is history.
export function createCaptchaCatches(): (snapshot: readonly SectionRun[]) => number {
  const seen = new Set<string>()
  let primed = false
  return (snapshot) => {
    let fresh = 0
    for (const run of snapshot) {
      run.targets.forEach((target, i) => {
        const key = `${run.id}:${i}`
        if (!target.captchaSolved || seen.has(key)) return
        seen.add(key)
        if (primed) fresh += 1
      })
    }
    primed = true
    return fresh
  }
}
