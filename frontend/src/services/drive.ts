import { createClient } from './http'
import { BACKEND_URL } from './runtime'

// Linking a Google account to Drive. Apart from `settings.ts` because `DriveConsentPrompt` calls it
// outside the settings screens.
const backend = createClient(BACKEND_URL, 'backend service')

/** Token stored (an expired one refreshes silently), a flow waiting on the browser, and whether a
 *  step gave up for want of a token. Always answered: none of the three is a failure. */
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
  const raw = await backend.post<{ auth_url: string }>('/config/drive/connect')
  return raw.auth_url
}

export async function disconnectDrive(): Promise<void> {
  await backend.post('/config/drive/disconnect')
}
