import type { Kind } from '../types'

export function httpError(res: Response): Error {
  return new Error(`${res.status} ${res.statusText}`)
}

export function kindQuery(kind: Kind | undefined): string {
  return kind === 'recitation' ? '?kind=recitation' : ''
}

export type RequestOptions = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit }

export interface Client {
  get<T>(path: string, init?: RequestOptions): Promise<T>
  post<T>(path: string, init?: RequestOptions): Promise<T>
  put<T>(path: string, init?: RequestOptions): Promise<T>
  delete<T>(path: string, init?: RequestOptions): Promise<T>
  request(path: string, init?: RequestOptions): Promise<Response>
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

export function createClient(baseUrl: string): Client {
  const url = (path: string) => `${baseUrl}${path}`

  const request = (path: string, init?: RequestOptions) => {
    const method = init?.method ?? 'GET'
    return fetch(url(path), buildInit(init, method))
  }

  const json = async <T>(path: string, method: string, init?: RequestOptions): Promise<T> => {
    const res = await fetch(url(path), buildInit(init, method))
    if (!res.ok) throw httpError(res)
    return res.json() as Promise<T>
  }

  return {
    get: (path, init) => json(path, 'GET', init),
    post: (path, init) => json(path, 'POST', init),
    put: (path, init) => json(path, 'PUT', init),
    delete: (path, init) => json(path, 'DELETE', init),
    request,
    url,
  }
}
