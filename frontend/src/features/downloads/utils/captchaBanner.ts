import type { AuthStatus } from '@/features/downloads/services/autoDownloader'

// Which captcha a FastStudy-opened Chrome window waits on, or null for none. The university site's
// challenge wins when both wait: the banner then names the site, whose captcha blocks every Moodle call.
export type CaptchaWait = 'zoom' | 'site'

export function captchaWait(status: AuthStatus | null): CaptchaWait | null {
  if (status?.challenge?.captcha) return 'site'
  return status?.zoomCaptcha ? 'zoom' : null
}
