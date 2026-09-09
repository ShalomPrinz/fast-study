import { describe, it, expect, vi, afterEach } from 'vitest'
import { listRecordings, isBlockedError, isReconnectError } from './autoDownloader'

// Minimal stand-ins for the parts of Response this boundary touches: it reads the status and,
// for a status it discriminates, the body.
function withBody(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    statusText: 'Error',
    headers: { get: () => null },
    json: async () => body,
    text: async () => '',
  } as unknown as Response
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
