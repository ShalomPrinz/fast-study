import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.fn()
vi.mock('@/services/toaster', () => ({ toast: (...a: unknown[]) => toast(...a) }))

import { announceNotices, resetNotices } from './notices'

const n = (id: number) => ({ id, code: 'model_fallback', params: { from: 'a', to: 'b' } })

describe('announceNotices', () => {
  beforeEach(() => {
    resetNotices()
    toast.mockClear()
  })

  it('stays quiet about notices present on the first load', () => {
    announceNotices('runner', [n(1)])
    expect(toast).not.toHaveBeenCalled()
  })

  it('toasts a later notice once per id across refetches', () => {
    announceNotices('runner', [n(1)])
    announceNotices('runner', [n(1), n(2)])
    announceNotices('runner', [n(1), n(2)])
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toBe('info')
  })

  it('primes each source on its own', () => {
    announceNotices('runner', [])
    announceNotices('overview:c', [n(5)])
    announceNotices('overview:c', [n(5), n(6)])
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
