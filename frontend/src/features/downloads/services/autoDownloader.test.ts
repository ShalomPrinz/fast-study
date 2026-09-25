import { describe, it, expect, vi, afterEach } from 'vitest'
import { isConnectionError, RequestError } from '@/services/http'
import { listRecordings, isBlockedError, isReconnectError } from './autoDownloader'

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
