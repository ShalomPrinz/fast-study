import { toastConnectionError } from '@/services/toaster'

export function httpError(res: Response): Error {
  return new Error(`${res.status} ${res.statusText}`)
}

// A request that never reached the server (service down); toasted centrally on construction.
export class ConnectionError extends Error {
  constructor(
    public serviceName: string,
    public baseUrl: string,
    public cause?: unknown,
  ) {
    super(`Can't reach ${serviceName} at ${baseUrl}. Make sure it's running.`)
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
  url(path: string): string
}

function buildInit(init: RequestOptions | undefined, method: string): RequestInit {
  const { json, body, headers, ...rest } = init ?? {}
  if (json !== undefined && body !== undefined) {
    throw new Error('http client: `json` and `body` are mutually exclusive')
  }
  if (json !== undefined) {
    return {
      ...rest,
      method,
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(json),
    }
  }
  return { ...rest, method, headers, body }
}

export function createClient(baseUrl: string, serviceName: string): Client {
  const url = (path: string) => `${baseUrl}${path}`

  const json = async <T>(path: string, method: string, init?: RequestOptions): Promise<T> => {
    const reqInit = buildInit(init, method)
    let res: Response
    try {
      res = await fetch(url(path), reqInit)
    } catch (err) {
      // Per the Fetch spec only network failures reject as TypeError; aborts are DOMException.
      if (err instanceof TypeError) {
        const ce = new ConnectionError(serviceName, baseUrl, err)
        toastConnectionError(ce)
        throw ce
      }
      throw err
    }
    if (!res.ok) throw httpError(res)
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
    url,
  }
}
