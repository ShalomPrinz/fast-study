import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectionError, RequestError } from '@/services/http'
import { UnsupportedError } from '@/features/downloads/services/autoDownloader'
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

  it("carries a typed refusal's code and params through, not only a RequestError's", () => {
    const params = { site: 'moodle.example.ac.il', reason: 'not_moodle' }
    const failure = failureOf(new UnsupportedError('not Moodle', 'moodle_site_unsupported', params))

    expect(failure).toEqual({ message: 'not Moodle', code: 'moodle_site_unsupported', params })
  })

  it('leaves a codeless typed refusal with prose only', () => {
    expect(failureOf(new UnsupportedError('not Moodle'))).toEqual({ message: 'not Moodle' })
  })

  it('reads a plain object with a string code, as the Electron bridge rejects', () => {
    expect(
      failureOf({
        code: 'setting_out_of_range',
        params: { field: 'autoRemoveAfter', min: 0, max: 23 },
        message: 'm',
      }),
    ).toEqual({
      message: 'm',
      code: 'setting_out_of_range',
      params: { field: 'autoRemoveAfter', min: 0, max: 23 },
    })
    expect(failureOf({ code: 'unknown_setting' })).toEqual({
      message: '',
      code: 'unknown_setting',
      params: null,
    })
  })

  it('leaves an object without a string code as prose', () => {
    expect(failureOf({ code: 5, message: 'm' }).code).toBeUndefined()
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
