import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionError } from '@/services/http'
import { toastFailure } from './failure'

// The toaster is the boundary under observation: what reaches it is the whole assertion.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast, toastConnectionError: vi.fn() }))

beforeEach(() => {
  toast.mockClear()
})

describe('toastFailure', () => {
  it("shows the service's own prose once for a refused request", () => {
    toastFailure(new Error('summary.md is missing'))

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('error', 'summary.md is missing')
  })

  it('stays silent for a connection error, which the http client already toasted', () => {
    toastFailure(new ConnectionError('backend service', 'http://localhost:8000'))

    expect(toast).not.toHaveBeenCalled()
  })
})
