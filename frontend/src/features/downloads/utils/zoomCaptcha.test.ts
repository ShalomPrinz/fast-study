import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SectionRun } from '@/features/downloads/services/downloadServer'
import { createCaptchaCatches, toastCaptchaSolved } from './zoomCaptcha'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast }))

beforeEach(() => {
  toast.mockClear()
})

describe('toastCaptchaSolved', () => {
  it('shows a success toast when the item waited on the captcha', () => {
    toastCaptchaSolved(true)

    expect(toast).toHaveBeenCalledOnce()
    expect(toast.mock.calls[0][0]).toBe('success')
  })

  it('says nothing when the answer carries no flag', () => {
    toastCaptchaSolved(undefined)

    expect(toast).not.toHaveBeenCalled()
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
