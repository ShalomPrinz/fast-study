import { describe, it, expect, vi, afterEach } from 'vitest'
import { isConnectionError, RequestError } from '@/services/http'
import {
  completeAuth,
  fetchAuthStatus,
  listRecordings,
  isBlockedError,
  isReconnectError,
  isUnsupportedError,
} from './autoDownloader'
import { loginFailure } from '../utils/downloadErrors'

const { toastConnectionError } = vi.hoisted(() => ({ toastConnectionError: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast: vi.fn(), toastConnectionError }))

// A real Response, so the boundary can read a clone of the body and still hand the original on.
function withBody(status: number, body: unknown): Response {
  return Response.json(body, { status })
}

function stubFetch(res: Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the blocked discriminator', () => {
  it('turns a 503 blocked body into a BlockedError', async () => {
    stubFetch(withBody(503, { status: 'blocked', message: 'a log line, not UI copy' }))

    const err = await listRecordings('https://lemida.example/course/1').catch((e) => e)

    expect(isBlockedError(err)).toBe(true)
  })

  it('never reads as a reconnect — the challenge says nothing about the session', async () => {
    stubFetch(withBody(503, { status: 'blocked', message: 'a log line, not UI copy' }))

    const err = await listRecordings('https://lemida.example/course/1').catch((e) => e)

    expect(isReconnectError(err)).toBe(false)
  })

  it('carries whether a challenge window opened on a refused completion', async () => {
    stubFetch(
      withBody(503, {
        status: 'blocked',
        code: 'site_blocked',
        params: { challengeWindow: false },
      }),
    )

    const err = await completeAuth().catch((e) => e)

    expect(isBlockedError(err) && err.challengeWindow).toBe(false)
  })

  it('leaves a 503 that is not the blocked body as a generic failure', async () => {
    stubFetch(withBody(503, { error: 'service unavailable' }))

    const err = await listRecordings('https://lemida.example/course/1').catch((e) => e)

    expect(isBlockedError(err)).toBe(false)
    expect(err).toBeInstanceOf(Error)
  })
})

describe('an unreachable auto-downloader', () => {
  it('throws the shared ConnectionError and toasts it once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const err = await listRecordings('https://lemida.example/course/1').catch((e) => e)

    expect(isConnectionError(err)).toBe(true)
    expect(toastConnectionError).toHaveBeenCalledTimes(1)
  })
})

describe('any other refusal', () => {
  it("keeps the body's code and params", async () => {
    const body = { error: 'Moodle said no', code: 'moodle_ws_error', params: { detail: 'x' } }
    stubFetch(withBody(500, body))

    const err = await listRecordings('https://lemida.example/course/1').catch((e) => e)

    expect(err).toBeInstanceOf(RequestError)
    expect(err.code).toBe('moodle_ws_error')
    expect(err.params).toEqual({ detail: 'x' })
  })

  it('keeps the code on a discriminated status whose body is not the discriminator', async () => {
    stubFetch(withBody(401, { error: 'no', code: 'internal_error', params: {} }))

    const err = await listRecordings('https://lemida.example/course/1').catch((e) => e)

    expect(isReconnectError(err)).toBe(false)
    expect(err.code).toBe('internal_error')
  })
})

describe('the account with no university configured', () => {
  it('reads a 409 moodle_site_not_configured as an unconfigured answer, not a failure', async () => {
    stubFetch(
      withBody(409, {
        error: 'No Moodle site is configured.',
        code: 'moodle_site_not_configured',
        params: {},
      }),
    )
    expect(await fetchAuthStatus()).toEqual({
      connected: false,
      expired: false,
      unconfigured: true,
    })
  })

  it('still throws any other refusal', async () => {
    stubFetch(withBody(500, { error: 'boom', code: 'internal_error', params: {} }))
    expect(await fetchAuthStatus().catch((e) => e)).toBeInstanceOf(RequestError)
  })
})

describe('a login the site refuses', () => {
  it('carries moodle_site_unsupported and its reason out of a 422 /auth/complete', async () => {
    const params = {
      site: 'https://lemida.example',
      reason: 'missing_function',
      function: 'core_course_get_contents',
    }
    stubFetch(
      withBody(422, {
        status: 'unsupported',
        message: 'missing function',
        code: 'moodle_site_unsupported',
        params,
      }),
    )
    const err = await completeAuth().catch((e) => e)
    expect(isUnsupportedError(err)).toBe(true)
    expect(loginFailure(err)).toMatchObject({ code: 'moodle_site_unsupported', params })
  })

  it('reports a bot challenge during login as the wait, and leaves the rest to the generic path', async () => {
    stubFetch(withBody(503, { status: 'blocked', message: 'challenge' }))
    expect(typeof loginFailure(await completeAuth().catch((e) => e))).toBe('string')
    expect(loginFailure(new RequestError('timed out', 'moodle_login_timeout'))).toBeNull()
  })
})
