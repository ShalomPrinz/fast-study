import { createClient, httpError } from '@/services/http'
import type { Kind } from '@/types'

// Boundary for the auto-downloader service (persistent-browser BIU capture).
const autoDownloader = createClient(
  import.meta.env.VITE_AUTODL_URL ?? 'http://localhost:3053',
  'auto-downloader service',
)

export interface AuthStatus {
  connected: boolean
  expired: boolean
}

// Mechanism-agnostic discovery item. `ref` is an opaque token — round-trip it
// back to /download-item, never parse it. `expandable` true → resolve via
// /list/expand into downloadable children; false → downloadable directly.
export interface Item {
  ref: string
  title: string
  kind: Kind
  expandable: boolean
}

// Thrown when the stored BIU session is missing/expired. /list and /download-item
// answer HTTP 401 { status: 'reconnect' } in that case; we surface it distinctly so
// the UI steers the user to the Reconnect pill instead of a generic error toast.
export class ReconnectError extends Error {
  constructor() {
    super('BIU session expired — reconnect the account.')
    this.name = 'ReconnectError'
  }
}

export function isReconnectError(err: unknown): err is ReconnectError {
  return err instanceof ReconnectError
}

// Thrown when an expandable item's redirect target is an unsupported (non-YouTube)
// host. /list/expand answers HTTP 422 { status: 'unsupported', message } in that case;
// the message is a ready-to-display user-friendly string we surface verbatim (permanent
// failure — the UI shows it instead of a "try again" retry prompt).
export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedError'
  }
}

export function isUnsupportedError(err: unknown): err is UnsupportedError {
  return err instanceof UnsupportedError
}

// The shared http client hides the response body, so the { status: 'reconnect' }
// 401 signal can't be read through it — hence a small direct fetch here that reads
// the body on 401. NOTE: this bypasses the client's central ConnectionError
// wrapping, so a connection-refused here throws a raw TypeError rather than the
// friendly "service down" toast — acceptable for these two endpoints.
async function postReconnectAware<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(autoDownloader.url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    const data = await res.json().catch(() => null)
    if (data?.status === 'reconnect') throw new ReconnectError()
  }
  if (res.status === 422) {
    const data = await res.json().catch(() => null)
    if (data?.status === 'unsupported') {
      throw new UnsupportedError(data.message ?? 'Unsupported recording source.')
    }
  }
  if (!res.ok) throw httpError(res)
  return res.json() as Promise<T>
}

// Discover a course's recordings. Empty/expired session → ReconnectError.
export async function listRecordings(courseUrl: string): Promise<Item[]> {
  const { items } = await postReconnectAware<{ items: Item[] }>('/list', { courseUrl })
  return items
}

// Resolve one expandable item into its downloadable children (echo the opaque ref).
// Expired session → ReconnectError; unsupported (non-YouTube) redirect target → UnsupportedError.
export async function expandItem(ref: string): Promise<Item[]> {
  const { items } = await postReconnectAware<{ items: Item[] }>('/list/expand', { ref })
  return items
}

// Download one downloadable item (echo its opaque ref). Expired session → ReconnectError.
export async function downloadItem(args: {
  ref: string
  course: string
  name: string
  kind: Kind
}): Promise<{ ok: boolean }> {
  return postReconnectAware<{ ok: boolean }>('/download-item', args)
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return autoDownloader.get<AuthStatus>('/auth/status')
}

// Launches a headed browser on the machine for MFA; returns immediately.
export async function connectAuth(): Promise<{ status: string }> {
  return autoDownloader.post<{ status: string }>('/auth/connect')
}

// Persists the storageState and closes the headed browser once the user finishes login.
export async function completeAuth(): Promise<{ connected: boolean }> {
  return autoDownloader.post<{ connected: boolean }>('/auth/complete')
}
