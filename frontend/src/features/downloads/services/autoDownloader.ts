import { createClient, httpError } from '@/services/http'
import type { Kind } from '@/types'

// Feature-local boundary for the auto-downloader service (persistent-browser BIU capture).
const autoDownloader = createClient(
  import.meta.env.VITE_AUTODL_URL ?? 'http://localhost:3053',
  'auto-downloader service',
)

export interface AuthStatus {
  connected: boolean
  expired: boolean
}

// Mechanism-agnostic discovery item. `ref` is opaque — round-trip it, never parse it.
// `expandable` → resolve via /list/expand into children; `section` is the Moodle heading ('' if blank).
export interface Item {
  ref: string
  title: string
  kind: Kind
  expandable: boolean
  section: string
}

// HTTP 401 { status: 'reconnect' }: the stored BIU session is gone. Distinct type so the UI
// steers to the Reconnect pill instead of a generic error toast.
export class ReconnectError extends Error {
  constructor() {
    super('BIU session expired — reconnect the account.')
    this.name = 'ReconnectError'
  }
}

export function isReconnectError(err: unknown): err is ReconnectError {
  return err instanceof ReconnectError
}

// HTTP 422 { status: 'unsupported' } from /list/expand: non-YouTube redirect target.
// Permanent failure, and `message` is display-ready — show it verbatim, no retry prompt.
export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedError'
  }
}

export function isUnsupportedError(err: unknown): err is UnsupportedError {
  return err instanceof UnsupportedError
}

// HTTP 409 { status: 'passcode' }: recording gated behind a passcode the server lacks.
// The body's `name` is carried as `lecture` because it collides with Error.name.
export class PasscodeError extends Error {
  constructor(
    public reason: 'missing' | 'incorrect',
    public info?: { course?: string; lecture?: string },
  ) {
    super(`Zoom passcode ${reason}.`)
    this.name = 'PasscodeError'
  }
}

export function isPasscodeError(err: unknown): err is PasscodeError {
  return err instanceof PasscodeError
}

// These endpoints encode meaning in the response body, which the shared client discards — hence
// a direct fetch. Trade-off: no central ConnectionError wrapping, so a refused connection throws
// a raw TypeError instead of the friendly "service down" toast.
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
  if (res.status === 409) {
    const data = await res.json().catch(() => null)
    if (data?.status === 'passcode') {
      throw new PasscodeError(data.reason, { course: data.course, lecture: data.name })
    }
  }
  if (!res.ok) throw httpError(res)
  return res.json() as Promise<T>
}

export async function listRecordings(courseUrl: string): Promise<Item[]> {
  const { items } = await postReconnectAware<{ items: Item[] }>('/list', { courseUrl })
  return items
}

// Resolve one expandable item into its downloadable children.
export async function expandItem(ref: string): Promise<Item[]> {
  const { items } = await postReconnectAware<{ items: Item[] }>('/list/expand', { ref })
  return items
}

// True once at least one download has started by this request.
export async function downloadItem(args: {
  ref: string
  course: string
  name: string
  kind: Kind
}): Promise<boolean> {
  const data = await postReconnectAware<{ ok: boolean }>('/download-item', args)
  return data.ok
}

export async function saveZoomPasscode({
  course,
  name,
  passcode,
  scope,
}: {
  course: string
  name: string
  passcode: string
  scope: 'course' | 'lecture'
}): Promise<{ ok: boolean }> {
  return autoDownloader.post<{ ok: boolean }>('/zoom/passcode', {
    json: { course, name, passcode, scope },
  })
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return autoDownloader.get<AuthStatus>('/auth/status')
}

// Launches a headed browser on the host for MFA; returns immediately.
export async function connectAuth(): Promise<{ status: string }> {
  return autoDownloader.post<{ status: string }>('/auth/connect')
}

// Persists the storageState and closes the headed browser once the user finishes login.
export async function completeAuth(): Promise<{ connected: boolean }> {
  return autoDownloader.post<{ connected: boolean }>('/auth/complete')
}
