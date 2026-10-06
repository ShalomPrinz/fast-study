import type { Client } from '@/services/http'
import { createClient, failureError, RequestError } from '@/services/http'
import { AUTO_DOWNLOADER_URL } from '@/services/runtime'
import type { Kind } from '@/types'
import type { ErrorParams, ServiceFailure } from '@/shared/i18n/serviceErrors'

// Feature-local boundary for the auto-downloader service (Moodle discovery and capture).
const autoDownloader = createClient(AUTO_DOWNLOADER_URL, 'auto-downloader service')

export interface AuthStatus {
  connected: boolean
  expired: boolean
  // No university is configured in the auto-downloader, so there is no account to connect.
  unconfigured?: boolean
  // A token kept after a bot challenge blocked the post-login check: connected, site not yet verified.
  unverified?: boolean
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

// HTTP 401 { status: 'reconnect' }: the stored Moodle session is gone. Distinct type so the UI
// steers to the Reconnect pill instead of a generic error toast.
export class ReconnectError extends Error {
  constructor() {
    super('Moodle session expired — reconnect the account.')
    this.name = 'ReconnectError'
  }
}

export function isReconnectError(err: unknown): err is ReconnectError {
  return err instanceof ReconnectError
}

// HTTP 422 { status: 'unsupported' } from /list/expand: non-YouTube redirect target. Permanent
// failure — no retry prompt — and it names which source, so it carries the protocol's code.
export class UnsupportedError extends Error implements ServiceFailure {
  constructor(
    message: string,
    public code: string | null = null,
    public params: ErrorParams | null = null,
  ) {
    super(message)
    this.name = 'UnsupportedError'
  }
}

export function isUnsupportedError(err: unknown): err is UnsupportedError {
  return err instanceof UnsupportedError
}

// 503 `blocked`: a transient bot-protection challenge, never a reconnect. The body's `message` is a
// log line, so the UI writes its own copy (`utils/downloadErrors`).
// `challengeWindow` is only on a refused `/auth/complete`: a browser is open on the site to solve it in.
export class BlockedError extends Error {
  constructor(public challengeWindow: boolean | null = null) {
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

// The client's raw `send`, because its JSON path discards the body these endpoints encode meaning
// in; a downed service still throws the shared, already-toasted ConnectionError. See docs/SERVICES.md.
export async function postReconnectAware<T>(
  client: Client,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await client.send(path, 'POST', { json: body })
  if (!res.ok) {
    // Read from a clone, so a body that is none of these still reaches `failureError` unread.
    const data = await res
      .clone()
      .json()
      .catch(() => null)
    if (res.status === 401 && data?.status === 'reconnect') throw new ReconnectError()
    if (res.status === 422 && data?.status === 'unsupported') {
      throw new UnsupportedError(
        data.message ?? 'Unsupported recording source.',
        typeof data.code === 'string' ? data.code : null,
        data.params ?? null,
      )
    }
    if (res.status === 503 && data?.status === 'blocked')
      throw new BlockedError(
        typeof data.params?.challengeWindow === 'boolean' ? data.params.challengeWindow : null,
      )
    if (res.status === 409 && data?.status === 'passcode') {
      throw new PasscodeError(data.reason, { course: data.course, lecture: data.name })
    }
    throw await failureError(res)
  }
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

// A 409 `moodle_site_not_configured` is an answer, not a failure: there is simply no site yet.
export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    return await autoDownloader.get<AuthStatus>('/auth/status')
  } catch (err) {
    if (err instanceof RequestError && err.code === 'moodle_site_not_configured') {
      return { connected: false, expired: false, unconfigured: true }
    }
    throw err
  }
}

// Launches a headed browser on the host for MFA; returns immediately.
export async function connectAuth(): Promise<{ status: string }> {
  return autoDownloader.post<{ status: string }>('/auth/connect')
}

// Persists the token once the user finishes login. A site the post-login check refuses throws an
// `UnsupportedError` carrying `moodle_site_unsupported`, a bot challenge a `BlockedError`.
export async function completeAuth(): Promise<{ connected: boolean }> {
  return postReconnectAware<{ connected: boolean }>(autoDownloader, '/auth/complete', {})
}

// Deletes the stored session locally; reconnecting costs a full headed MFA round-trip. Idempotent.
export async function disconnectAuth(): Promise<{ connected: boolean }> {
  return autoDownloader.post<{ connected: boolean }>('/auth/disconnect')
}
