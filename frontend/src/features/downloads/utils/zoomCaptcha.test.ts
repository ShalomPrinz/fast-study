import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SectionRun } from '@/features/downloads/services/downloadServer'
import {
  createCaptchaCatches,
  toastCaptchaSolved,
  zoomCaptchaToastChange,
  ZOOM_CAPTCHA_TOAST_ID,
} from './zoomCaptcha'

const { toast, dismissToast } = vi.hoisted(() => ({ toast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast, dismissToast }))

beforeEach(() => {
  toast.mockClear()
  dismissToast.mockClear()
})

describe('zoomCaptchaToastChange', () => {
  it('shows the toast when the flag turns on and dismisses it when it turns off', () => {
    expect(zoomCaptchaToastChange(false, true)).toBe('show')
    expect(zoomCaptchaToastChange(true, false)).toBe('dismiss')
  })

  it('does nothing on a repeated value, so a closed toast stays closed', () => {
    expect(zoomCaptchaToastChange(true, true)).toBeNull()
    expect(zoomCaptchaToastChange(false, false)).toBeNull()
  })
})

describe('toastCaptchaSolved', () => {
  it('shows a success toast when the item waited on the captcha', () => {
    toastCaptchaSolved(true)

    expect(toast).toHaveBeenCalledOnce()
    expect(toast.mock.calls[0][0]).toBe('success')
  })

  it("leaves the next item's waiting toast up when an earlier item's success lands late", () => {
    // A solved: the flag clears. B hits a captcha: the flag rises. Then A's answer lands.
    expect(zoomCaptchaToastChange(true, false)).toBe('dismiss')
    expect(zoomCaptchaToastChange(false, true)).toBe('show')
    toastCaptchaSolved(true)

    expect(dismissToast).not.toHaveBeenCalledWith(ZOOM_CAPTCHA_TOAST_ID)
    expect(toast).toHaveBeenCalledOnce()
  })

  it('says nothing when the answer carries no flag', () => {
    toastCaptchaSolved(undefined)

    expect(toast).not.toHaveBeenCalled()
    expect(dismissToast).not.toHaveBeenCalled()
  })
})

describe('createCaptchaCatches', () => {
  const run = (id: string, solved: boolean[]) =>
    ({ id, targets: solved.map((s) => (s ? { captchaSolved: true } : {})) }) as SectionRun

  it('seeds from the first snapshot without counting its catches', () => {
    const caught = createCaptchaCatches()

    expect(caught([run('r1', [true, false])])).toBe(0)
  })

  it('counts a target that turns solved once, and not again on later resyncs', () => {
    const caught = createCaptchaCatches()
    caught([run('r1', [false, false])])

    expect(caught([run('r1', [false, true])])).toBe(1)
    expect(caught([run('r1', [false, true])])).toBe(0)
  })

  it('keys by run id, so the same index in a new run counts again', () => {
    const caught = createCaptchaCatches()
    caught([run('r1', [true])])

    expect(caught([run('r2', [true])])).toBe(1)
  })
})
