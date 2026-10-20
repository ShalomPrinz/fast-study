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

// `frame` is true once per rise of `challenge.solved`. The first frame after `reseed` (each reconnect)
// and a lower count (auto restarted) only seed, so a solve from before them is history.
export function createSiteCaptchaSolves(): {
  frame: (status: AuthStatus) => boolean
  reseed: () => void
} {
  let last: number | null = null
  return {
    frame(status) {
      const solved = status.challenge?.solved
      if (solved === undefined) return false
      const rose = last !== null && solved > last
      last = solved
      return rose
    },
    reseed() {
      last = null
    },
  }
}

// The university site's captcha was solved and the Moodle call waiting on it carries on; any action.
export function toastSiteCaptchaSolved(): void {
  toast('success', t`Captcha solved. Continuing.`)
}
