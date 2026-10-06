import type { AuthStatus } from '../services/autoDownloader'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'

// What this tab itself is doing: reading the status the first time, posting a connect, retrying the
// verification or posting a disconnect. A login running in the browser window is the service's `pending`.
export type LoginPhase = 'loading' | 'idle' | 'connecting' | 'verifying' | 'disconnecting'

export type AccountChip =
  | 'checking'
  | 'finishing'
  | 'unconfigured'
  | 'unverified'
  | 'connected'
  | 'expired'
  | 'disconnected'

// Which explanation sits beside an unverified chip: a window is open, none could open (use your own
// browser), or nothing is known about one (an unverified token with no recorded block).
export type AccountPanel = 'window' | 'own-browser' | 'unknown'

export interface AccountView {
  chip: AccountChip
  panel: AccountPanel | null
}

// The one decision behind the account chip and its panel: the local phase and the pushed status in, what to
// show out. A token kept after a block is its own state, neither connected nor not, and the service's
// `site_blocked` error says whether a challenge window opened.
export function accountView(phase: LoginPhase, status: AuthStatus | null): AccountView {
  if (phase === 'loading') return { chip: 'checking', panel: null }
  if (phase === 'connecting' || status?.phase === 'pending')
    return { chip: 'finishing', panel: null }
  if (status?.unconfigured) return { chip: 'unconfigured', panel: null }
  if (status?.unverified) {
    const open =
      status.error?.code === 'site_blocked' ? status.error.params?.challengeWindow : undefined
    return {
      chip: 'unverified',
      panel: open === true ? 'window' : open === false ? 'own-browser' : 'unknown',
    }
  }
  if (status?.connected && !status.expired) return { chip: 'connected', panel: null }
  return { chip: status?.expired ? 'expired' : 'disconnected', panel: null }
}

export type LoginToast =
  { kind: 'blocked' } | { kind: 'reconnect' } | { kind: 'failure'; failure: ServiceFailure }

// A login failure is toasted once, on the frame that ends a run this tab watched: the previous frame was
// `pending` and this one is not. A replayed state (a resubscribe, a reload) shows its leftover error in the
// chip's state but never toasts it.
export function loginToast(prev: AuthStatus | null, next: AuthStatus | null): LoginToast | null {
  if (prev?.phase !== 'pending' || !next || next.phase === 'pending' || !next.error) return null
  const { code, params } = next.error
  if (code === 'site_blocked') return { kind: 'blocked' }
  if (code === 'moodle_reconnect_required') return { kind: 'reconnect' }
  return { kind: 'failure', failure: { message: String(params?.detail ?? code), code, params } }
}
