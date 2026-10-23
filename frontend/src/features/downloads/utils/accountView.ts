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

// Which explanation sits beside an unverified chip: a captcha waits, was just solved, was closed unsolved, the
// window passed with none (just retry), none could open (use your own browser), or nothing is known.
export type AccountPanel = 'window' | 'solved' | 'closed' | 'ready' | 'own-browser' | 'unknown'

export interface AccountView {
  chip: AccountChip
  panel: AccountPanel | null
}

// The one decision behind the account chip and its panel; an unverified token is its own state, and
// `captchaSeen` (from `captchaSeen()`) tells a solved captcha from a window still loading one.
export function accountView(
  phase: LoginPhase,
  status: AuthStatus | null,
  captchaSeen = false,
): AccountView {
  if (phase === 'loading') return { chip: 'checking', panel: null }
  if (phase === 'connecting' || status?.phase === 'pending')
    return { chip: 'finishing', panel: null }
  if (status?.unconfigured) return { chip: 'unconfigured', panel: null }
  if (status?.unverified) return { chip: 'unverified', panel: unverifiedPanel(status, captchaSeen) }
  if (status?.connected && !status.expired) return { chip: 'connected', panel: null }
  return { chip: status?.expired ? 'expired' : 'disconnected', panel: null }
}

// Whether the open challenge window has shown a captcha since it opened: a window that just opened shows
// none yet either, and only one that showed it and stopped was solved. Fold it over the pushed frames.
export function captchaSeen(prev: boolean, status: AuthStatus | null): boolean {
  if (status?.challenge?.captcha) return true
  return Boolean(status?.challenge?.open) && prev
}

// Whether a site captcha solve toasts: not when a mounted account panel already says it was solved.
export function siteSolveToasts(status: AuthStatus, accountPanelShown: boolean): boolean {
  return !accountPanelShown || accountView('idle', status, true).panel !== 'solved'
}

// The block's `challengeWindow` as recorded, corrected by the live `challenge` frame when it has one. A
// recorded captcha gone from a still-open window was solved, and abandoned once the window closed.
function unverifiedPanel(status: AuthStatus, seen: boolean): AccountPanel {
  const recorded =
    status.error?.code === 'site_blocked' ? challengeWindowOf(status.error.params) : null
  const challenge = status.challenge
  if (challenge?.captcha) return 'window'
  if (recorded === 'captcha') {
    if (!challenge) return 'window'
    if (!challenge.open) return 'closed'
    return seen ? 'solved' : 'window'
  }
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

// Whether the Connect confirm stays up: only while Connect is on screen and a foreign token is still there,
// so a frame that clears either closes it instead of leaving it to reappear later.
export function connectConfirmOpen(
  open: boolean,
  chip: AccountChip,
  hasForeignToken: boolean,
): boolean {
  return open && hasForeignToken && (chip === 'disconnected' || chip === 'expired')
}
