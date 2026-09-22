import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionError, RequestError } from '@/services/http'
import { failureOf, toastFailure } from './failure'

// The toaster is the boundary under observation: that it fired at all is the whole assertion —
// what it says is the resolver's job (`shared/i18n/serviceErrors.test.ts`).
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast, toastConnectionError: vi.fn() }))

beforeEach(() => {
  toast.mockClear()
})

describe('failureOf', () => {
  it("carries a refused request's code and params through", () => {
    const failure = failureOf(
      new RequestError('summary.md is missing', 'file_not_found', {
        file: 'summary.md',
      }),
    )

    expect(failure).toEqual({
      message: 'summary.md is missing',
      code: 'file_not_found',
      params: { file: 'summary.md' },
    })
  })

  it('leaves a plain error with prose only, so it falls back to it', () => {
    expect(failureOf(new Error('boom'))).toEqual({ message: 'boom' })
  })
})

describe('toastFailure', () => {
  it('reports a refused request once', () => {
    toastFailure(new RequestError('summary.md is missing'))

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toBe('error')
  })

  it('stays silent for a connection error, which the http client already toasted', () => {
    toastFailure(new ConnectionError('backend service', 'http://localhost:8000'))

    expect(toast).not.toHaveBeenCalled()
  })
})
