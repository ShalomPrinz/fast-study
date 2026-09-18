import type { Client } from '@/services/http'
import { createClient, httpError } from '@/services/http'
import { AUTO_DOWNLOADER_URL, secretHeaders } from '@/services/runtime'
import type { Kind } from '@/types'

// Feature-local boundary for the auto-downloader service (persistent-browser BIU capture).
const autoDownloader = createClient(AUTO_DOWNLOADER_URL, 'auto-downloader service')

export interface AuthStatus {
  connected: boolean
  expired: boolean
}

// Which file the item lands on disk as; the destination is derived server-side from `ref`.
// A Google Drive row is 'unknown': its file type is only knowable from a download-time probe.
export type Media = 'video' | 'material' | 'unknown'

// What a probe found the file to be. 'unsupported' is a real file auto can't use (e.g. a .zip).
export type ProbedMedia = 'video' | 'material'
export type ResolvedMedia = ProbedMedia | 'unsupported'

// A discovery item; `ref` is opaque — round-trip it, never parse it. `resolvedMedia` and
// `likelyRecording` are covered in docs/DOWNLOADS.md §Discovery.
export interface Item {
  ref: string
  title: string
  kind: Kind
  media: Media
  resolvedMedia?: ResolvedMedia
  expandable: boolean
  section: string
  likelyRecording?: boolean
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

// 503 `blocked`: a transient bot-protection challenge, never a reconnect. The body's `message` is a
// log line, so the UI writes its own copy (`utils/downloadErrors`).
export class BlockedError extends Error {
  constructor() {
    super('The site is refusing automated requests — bot-protection challenge.')
    this.name = 'BlockedError'
  }
}

export function isBlockedError(err: unknown): err is BlockedError {
  return err instanceof BlockedError
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

// A direct fetch, secret added by hand, because the shared client discards the body these endpoints
// encode meaning in — see docs/SERVICES.md for the trade-off and why it takes a `Client`.
export async function postReconnectAware<T>(
  client: Client,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(client.url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...secretHeaders() },
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
  if (res.status === 503) {
    const data = await res.json().catch(() => null)
    if (data?.status === 'blocked') throw new BlockedError()
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
  const { items } = await postReconnectAware<{ items: Item[] }>(autoDownloader, '/list', {
    courseUrl,
  })
  return items
}

// Resolve one expandable item into its downloadable children.
export async function expandItem(ref: string): Promise<Item[]> {
  const { items } = await postReconnectAware<{ items: Item[] }>(autoDownloader, '/list/expand', {
    ref,
  })
  return items
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
}): Promise<void> {
  await autoDownloader.post<void>('/zoom/passcode', {
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

// Deletes the stored session locally; reconnecting costs a full headed MFA round-trip. Idempotent.
export async function disconnectAuth(): Promise<{ connected: boolean }> {
  return autoDownloader.post<{ connected: boolean }>('/auth/disconnect')
}
