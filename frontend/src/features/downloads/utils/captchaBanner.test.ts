import { describe, it, expect } from 'vitest'
import type { AuthStatus } from '@/features/downloads/services/autoDownloader'
import { captchaWait, createSiteCaptchaSolves } from './captchaBanner'

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

describe('createSiteCaptchaSolves', () => {
  const at = (solved: number, captcha = false, moodleBusy = false): AuthStatus => ({
    ...base,
    moodleBusy,
    challenge: { open: captcha, captcha, solved },
  })

  it('seeds on the first frame and fires once per rise of the counter', () => {
    const solves = createSiteCaptchaSolves()
    expect(solves.frame(at(2))).toBeNull()
    expect(solves.frame(at(2, true))).toBeNull()
    expect(solves.frame(at(3))).toBe('solved')
    expect(solves.frame(at(3))).toBeNull()
    expect(solves.frame(at(4))).toBe('solved')
  })

  it('only seeds on the first frame after a reconnect, even when the count rose meanwhile', () => {
    const solves = createSiteCaptchaSolves()
    solves.frame(at(1))
    solves.reseed()
    expect(solves.frame(at(3))).toBeNull()
    expect(solves.frame(at(4))).toBe('solved')
  })

  it('seeds afresh on a lower count (auto restarted) and ignores frames without one', () => {
    const solves = createSiteCaptchaSolves()
    solves.frame(at(5))
    expect(solves.frame(at(0))).toBeNull()
    expect(solves.frame(base)).toBeNull()
    expect(solves.frame(at(1))).toBe('solved')
  })

  it('says continuing only when the last captcha frame before the solve had a call waiting', () => {
    const solves = createSiteCaptchaSolves()
    solves.frame(at(0, true, true))
    expect(solves.frame(at(1, false, true))).toBe('continuing')
    solves.frame(at(1, true, true))
    solves.frame(at(1, true, false))
    expect(solves.frame(at(2))).toBe('solved')
  })

  it('forgets a waiting call on reseed', () => {
    const solves = createSiteCaptchaSolves()
    solves.frame(at(0))
    solves.frame(at(0, true, true))
    solves.reseed()
    solves.frame(at(0))
    expect(solves.frame(at(1))).toBe('solved')
  })
})
