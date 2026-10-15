import { describe, it, expect } from 'vitest'
import type { AuthStatus } from '@/features/downloads/services/autoDownloader'
import { captchaWait } from './captchaBanner'

const base: AuthStatus = { connected: true, expired: false }

describe('captchaWait', () => {
  it('is null with no status or no captcha waiting', () => {
    expect(captchaWait(null)).toBeNull()
    expect(captchaWait(base)).toBeNull()
    expect(
      captchaWait({ ...base, zoomCaptcha: false, challenge: { open: true, captcha: false } }),
    ).toBeNull()
  })

  it('is zoom while only a zoom captcha waits', () => {
    expect(captchaWait({ ...base, zoomCaptcha: true })).toBe('zoom')
  })

  it('names the site while its challenge waits, alone or beside a zoom captcha', () => {
    expect(captchaWait({ ...base, challenge: { open: true, captcha: true } })).toBe('site')
    expect(
      captchaWait({ ...base, zoomCaptcha: true, challenge: { open: true, captcha: true } }),
    ).toBe('site')
  })
})
