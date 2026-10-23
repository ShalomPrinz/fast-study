import { t } from '@lingui/core/macro'
import type { AuthStatus } from '@/features/downloads/services/autoDownloader'
import { toast } from '@/services/toaster'

// Which captcha a FastStudy-opened Chrome window waits on, or null for none. The university site's
// challenge wins when both wait: the banner then names the site, whose captcha blocks every Moodle call.
export type CaptchaWait = 'zoom' | 'site'

export function captchaWait(status: AuthStatus | null): CaptchaWait | null {
  if (status?.challenge?.captcha) return 'site'
  return status?.zoomCaptcha ? 'zoom' : null
}

// What a solve frame says: `continuing` when a routed call waited on it, `solved` when nothing did.
export type SiteCaptchaSolve = 'continuing' | 'solved'

// `frame` names each rise of `challenge.solved`; the first frame after `reseed` and a lower count only seed.
// `moodleBusy` with `captcha` approximates a waiting call; one queued behind the captcha reads `solved`.
export function createSiteCaptchaSolves(): {
  frame: (status: AuthStatus) => SiteCaptchaSolve | null
  reseed: () => void
} {
  let last: number | null = null
  let waiting = false
  return {
    frame(status) {
      const waited = waiting
      waiting = Boolean(status.challenge?.captcha && status.moodleBusy)
      const solved = status.challenge?.solved
      if (solved === undefined) return null
      const rose = last !== null && solved > last
      last = solved
      if (!rose) return null
      return waited ? 'continuing' : 'solved'
    },
    reseed() {
      last = null
      waiting = false
    },
  }
}

// The university site's captcha was solved; "Continuing." only when a Moodle call waited on it. Any action.
export function toastSiteCaptchaSolved(solve: SiteCaptchaSolve): void {
  toast('success', solve === 'continuing' ? t`Captcha solved. Continuing.` : t`Captcha solved.`)
}
