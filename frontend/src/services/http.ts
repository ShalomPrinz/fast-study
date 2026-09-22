import { t } from '@lingui/core/macro'
import { secretHeaders } from '@/services/runtime'
import { toastConnectionError } from '@/services/toaster'
import type { ErrorParams, ServiceFailure } from '@/shared/i18n/serviceErrors'

// A request a service refused. It carries the protocol's machine `code` and flat `params` beside
// the service's English prose, so the render site can say it in the user's language and fall back
// to the prose when the code has no catalog row — repo-root docs/ERROR-CODES.md.
export class RequestError extends Error implements ServiceFailure {
  constructor(
    message: string,
    public code: string | null = null,
    public params: ErrorParams | null = null,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}

export function httpError(res: Response): RequestError {
  return new RequestError(`${res.status} ${res.statusText}`)
}

// Every service reports a failure as `{error, code, params}`, whose prose says far more than the
// status line (a data root that turned out not to be writable, not "400 Bad Request").
async function failureError(res: Response): Promise<RequestError> {
  try {
    const body = JSON.parse(await res.text())
    const message = body?.error
    if (typeof message === 'string' && message) {
      const code = typeof body?.code === 'string' ? body.code : null
      const params = body?.params && typeof body.params === 'object' ? body.params : null
      return new RequestError(message, code, params)
    }
  } catch {
    // Not JSON, or no body at all — the status line is all there is to report.
  }
  return httpError(res)
}

// A request that never reached the server (service down); toasted centrally on construction.
export class ConnectionError extends Error {
  constructor(
    public serviceName: string,
    public baseUrl: string,
    public cause?: unknown,
  ) {
    super(t`Can't reach ${serviceName} at ${baseUrl}. Make sure it's running.`)
    this.name = 'ConnectionError'
  }
}

export function isConnectionError(err: unknown): err is ConnectionError {
  return err instanceof ConnectionError
}

export type RequestOptions = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit }

export interface Client {
  get<T>(path: string, init?: RequestOptions): Promise<T>
  post<T>(path: string, init?: RequestOptions): Promise<T>
  put<T>(path: string, init?: RequestOptions): Promise<T>
  patch<T>(path: string, init?: RequestOptions): Promise<T>
  delete<T>(path: string, init?: RequestOptions): Promise<T>
  // The raw response, for a caller that reads meaning out of a refusal's body; a network failure
  // still becomes a toasted ConnectionError.
  send(path: string, method: string, init?: RequestOptions): Promise<Response>
  url(path: string): string
}

function buildInit(init: RequestOptions | undefined, method: string): RequestInit {
  const { json, body, headers, ...rest } = init ?? {}
  if (json !== undefined && body !== undefined) {
    throw new Error('http client: `json` and `body` are mutually exclusive')
  }
  // Every request carries the launch secret; the caller's own headers still win over it.
  const secured = { ...secretHeaders(), ...(headers ?? {}) }
  if (json !== undefined) {
    return {
      ...rest,
      method,
      headers: { 'Content-Type': 'application/json', ...secured },
      body: JSON.stringify(json),
    }
  }
  return { ...rest, method, headers: secured, body }
}

export function createClient(baseUrl: string, serviceName: string): Client {
  const url = (path: string) => `${baseUrl}${path}`

  const send = async (path: string, method: string, init?: RequestOptions): Promise<Response> => {
    const reqInit = buildInit(init, method)
    try {
      return await fetch(url(path), reqInit)
    } catch (err) {
      // Per the Fetch spec only network failures reject as TypeError; aborts are DOMException.
      if (err instanceof TypeError) {
        const ce = new ConnectionError(serviceName, baseUrl, err)
        toastConnectionError(ce)
        throw ce
      }
      throw err
    }
  }

  const json = async <T>(path: string, method: string, init?: RequestOptions): Promise<T> => {
    const res = await send(path, method, init)
    if (!res.ok) throw await failureError(res)
    // Mutations answer 204 with no body; res.json() would throw a SyntaxError on it.
    if (res.status === 204 || res.headers.get('Content-Length') === '0') return undefined as T
    return res.json() as Promise<T>
  }

  return {
    get: (path, init) => json(path, 'GET', init),
    post: (path, init) => json(path, 'POST', init),
    put: (path, init) => json(path, 'PUT', init),
    patch: (path, init) => json(path, 'PATCH', init),
    delete: (path, init) => json(path, 'DELETE', init),
    send,
    url,
  }
}
