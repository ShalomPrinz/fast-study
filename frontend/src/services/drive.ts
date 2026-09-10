import { t } from '@lingui/core/macro'
import { createClient } from './http'
import { BACKEND_URL } from './runtime'

// The boundary for linking a Google account to Drive: the consent flow's state, its start and its
// undo. Separate from `settings.ts` because it has a caller outside the settings screens — the
// prompt that asks for consent when a run needs it.
const backend = createClient(BACKEND_URL, 'backend service')

/** A stored token (an expired one still counts — it refreshes silently), a consent flow waiting on
 *  the browser, and whether a pipeline step gave up for want of a token. Always answers: none of
 *  the three is a failure. */
export interface DriveStatus {
  connected: boolean
  pending: boolean
  consentNeeded: boolean
}

interface RawStatus {
  connected: boolean
  pending: boolean
  consent_needed: boolean
}

export async function fetchDriveStatus(): Promise<DriveStatus> {
  const raw = await backend.get<RawStatus>('/config/drive/status')
  return { connected: raw.connected, pending: raw.pending, consentNeeded: raw.consent_needed }
}

/** Starts the flow and returns the URL the backend has already opened a browser on, so the URL is
 *  only a "didn't open?" fallback. A second call while one is pending answers the same URL. */
export async function connectDrive(): Promise<string> {
  const raw = await backend.post<{ auth_url?: string; message?: string }>('/config/drive/connect')
  // No `auth_url` is the error envelope missing `credentials.json` answers with.
  if (!raw.auth_url) throw new Error(raw.message ?? t`Couldn't start the Google sign-in.`)
  return raw.auth_url
}

export async function disconnectDrive(): Promise<void> {
  await backend.post('/config/drive/disconnect')
}
