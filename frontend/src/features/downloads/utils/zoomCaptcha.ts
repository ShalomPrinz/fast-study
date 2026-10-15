import { t } from '@lingui/core/macro'
import type { SectionRun } from '@/features/downloads/services/downloadServer'
import { toast } from '@/services/toaster'

// The held toast `ZoomCaptchaToast` raises while `/auth/events` says a zoom captcha wait is on.
export const ZOOM_CAPTCHA_TOAST_ID = 'zoom-captcha'

// What a new `/auth/events` frame does to the zoom captcha toast: only a flip acts, so a repeated `true`
// never re-raises a toast the user closed. `prev` starts false, so a page opened mid-wait still shows it.
export function zoomCaptchaToastChange(prev: boolean, next: boolean): 'show' | 'dismiss' | null {
  if (next === prev) return null
  return next ? 'show' : 'dismiss'
}

// A `captchaSolved` this item's capture reported: says so briefly. It never touches the waiting toast,
// whose lifetime is the `/auth/events` flag alone: a late answer must not close the next item's wait.
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
