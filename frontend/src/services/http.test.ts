import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createClient, isConnectionError, type ConnectionError } from './http'

const { toastConnectionError } = vi.hoisted(() => ({ toastConnectionError: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toastConnectionError }))

const BASE = 'http://svc.test'

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(impl)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function failing(status: number, statusText: string, body: string): Response {
  return new Response(body, { status, statusText })
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (err) {
    return err as Error
  }
  throw new Error('expected the request to reject')
}

beforeEach(() => {
  toastConnectionError.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('http client failure prose', () => {
  const client = createClient(BASE, 'test service')

  async function messageFor(body: string, status = 500, statusText = 'Internal Server Error') {
    stubFetch(async () => failing(status, statusText, body))
    return (await rejection(client.get('/x'))).message
  }

  it("shows the body's error prose and ignores detail or message", async () => {
    expect(await messageFor(JSON.stringify({ error: 'e' }))).toBe('e')
    expect(await messageFor(JSON.stringify({ detail: 'd' }))).toBe('500 Internal Server Error')
    expect(await messageFor(JSON.stringify({ message: 'm' }))).toBe('500 Internal Server Error')
  })

  it('falls back to the status line for non-string or empty prose', async () => {
    expect(await messageFor(JSON.stringify({ error: [{ loc: ['body'] }] }))).toBe(
      '500 Internal Server Error',
    )
    expect(await messageFor(JSON.stringify({ error: '' }))).toBe('500 Internal Server Error')
  })

  it('falls back to the status line for a non-JSON or empty body', async () => {
    expect(await messageFor('<html>oops</html>')).toBe('500 Internal Server Error')
    expect(await messageFor('')).toBe('500 Internal Server Error')
  })

  it('replaces a 423 body with its own message', async () => {
    const message = await messageFor(JSON.stringify({ error: 'locked by pid 42' }), 423, 'Locked')
    expect(message).not.toBe('locked by pid 42')
    expect(message).not.toBe('423 Locked')
  })
})

describe('http client transport failures', () => {
  const client = createClient(BASE, 'test service')

  it('turns a network TypeError into one toasted ConnectionError', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const err = await rejection(client.get('/x'))

    expect(isConnectionError(err)).toBe(true)
    expect((err as ConnectionError).serviceName).toBe('test service')
    expect((err as ConnectionError).baseUrl).toBe(BASE)
    expect(toastConnectionError).toHaveBeenCalledTimes(1)
    expect(toastConnectionError).toHaveBeenCalledWith(err)
  })

  it('rethrows an abort untouched and does not toast', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    stubFetch(async () => {
      throw abort
    })

    expect(await rejection(client.get('/x'))).toBe(abort)
    expect(toastConnectionError).not.toHaveBeenCalled()
  })
})

describe('http client bodies', () => {
  const client = createClient(BASE, 'test service')

  function empty(status: number, contentLength: string | null) {
    const json = vi.fn()
    const res = {
      ok: true,
      status,
      headers: { get: (h: string) => (h === 'Content-Length' ? contentLength : null) },
      json,
    } as unknown as Response
    return { res, json }
  }

  it('resolves a 204 to undefined without parsing', async () => {
    const { res, json } = empty(204, null)
    stubFetch(async () => res)
    await expect(client.delete('/x')).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })

  it('resolves a zero Content-Length to undefined without parsing', async () => {
    const { res, json } = empty(200, '0')
    stubFetch(async () => res)
    await expect(client.post('/x')).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })

  it('refuses json and body together before sending anything', async () => {
    const fetch = stubFetch(async () => new Response('{}'))
    await expect(client.post('/x', { json: { a: 1 }, body: 'raw' })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('http client headers', () => {
  // `runtime` resolves the secret at import, so `http` must be imported fresh after the stub.
  async function clientWithSecret(secret: string) {
    vi.resetModules()
    vi.stubGlobal('window', { faststudy: { secret } })
    const { createClient } = await import('./http')
    return createClient(BASE, 'test service')
  }

  function captured() {
    return stubFetch(async () => new Response('{}'))
  }

  function headersOf(fetch: ReturnType<typeof captured>): Record<string, string> {
    return fetch.mock.calls[0][1].headers as Record<string, string>
  }

  it('sends the launch secret on every request', async () => {
    const client = await clientWithSecret('s3cret')
    const fetch = captured()
    await client.get('/x')
    expect(headersOf(fetch)['X-FastStudy-Secret']).toBe('s3cret')
  })

  it("lets the caller's own secret header win", async () => {
    const client = await clientWithSecret('s3cret')
    const fetch = captured()
    await client.get('/x', { headers: { 'X-FastStudy-Secret': 'override' } })
    expect(headersOf(fetch)['X-FastStudy-Secret']).toBe('override')
  })

  it('serializes json with a JSON content type', async () => {
    const client = await clientWithSecret('s3cret')
    const fetch = captured()
    await client.post('/x', { json: { name: 'שלום' } })
    expect(headersOf(fetch)['Content-Type']).toBe('application/json')
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ name: 'שלום' }))
  })

  it('sends no secret header when there is no secret', async () => {
    const client = createClient(BASE, 'test service')
    const fetch = captured()
    await client.get('/x')
    expect(headersOf(fetch)).not.toHaveProperty('X-FastStudy-Secret')
  })
})
