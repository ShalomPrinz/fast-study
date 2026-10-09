import {
  challengeWindowOf,
  type AuthStatus,
  type ChallengeWindow,
} from '../services/autoDownloader'
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

// Which explanation sits beside an unverified chip: a captcha waits in a window, the window passed the
// check (just retry), none could open (use your own browser), or nothing is known about one.
export type AccountPanel = 'window' | 'ready' | 'own-browser' | 'unknown'

export interface AccountView {
  chip: AccountChip
  panel: AccountPanel | null
}

// The one decision behind the account chip and its panel: the local phase and the pushed status in, what to
// show out. A token kept after a block is its own state, neither connected nor not, and the service's
// `site_blocked` error says what the challenge window did.
export function accountView(phase: LoginPhase, status: AuthStatus | null): AccountView {
  if (phase === 'loading') return { chip: 'checking', panel: null }
  if (phase === 'connecting' || status?.phase === 'pending')
    return { chip: 'finishing', panel: null }
  if (status?.unconfigured) return { chip: 'unconfigured', panel: null }
  if (status?.unverified) return { chip: 'unverified', panel: unverifiedPanel(status) }
  if (status?.connected && !status.expired) return { chip: 'connected', panel: null }
  return { chip: status?.expired ? 'expired' : 'disconnected', panel: null }
}

// The block's `challengeWindow` as recorded, corrected by the live `challenge` frame when it has one: a
// captcha on screen now is the window panel, and a recorded captcha the window no longer shows is past.
function unverifiedPanel(status: AuthStatus): AccountPanel {
  const recorded =
    status.error?.code === 'site_blocked' ? challengeWindowOf(status.error.params) : null
  if (status.challenge?.captcha) return 'window'
  if (recorded === 'captcha') return status.challenge ? 'ready' : 'window'
  if (recorded === 'ready') return 'ready'
  return recorded === false ? 'own-browser' : 'unknown'
}

export type LoginToast =
  | { kind: 'blocked'; challengeWindow: ChallengeWindow }
  | { kind: 'reconnect' }
  | { kind: 'failure'; failure: ServiceFailure }

// A login failure is toasted once, on the frame that ends a run this tab watched: the previous frame was
// `pending` and this one is not. A replayed state (a resubscribe, a reload) shows its leftover error in the
// chip's state but never toasts it.
export function loginToast(prev: AuthStatus | null, next: AuthStatus | null): LoginToast | null {
  if (prev?.phase !== 'pending' || !next || next.phase === 'pending' || !next.error) return null
  const { code, params } = next.error
  if (code === 'site_blocked')
    return { kind: 'blocked', challengeWindow: challengeWindowOf(params) }
  if (code === 'moodle_reconnect_required') return { kind: 'reconnect' }
  return { kind: 'failure', failure: { message: String(params?.detail ?? code), code, params } }
}
