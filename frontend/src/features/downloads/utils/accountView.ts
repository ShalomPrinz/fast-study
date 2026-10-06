import type { AuthStatus } from '../services/autoDownloader'

export type LoginPhase =
  'loading' | 'idle' | 'connecting' | 'pending' | 'completing' | 'disconnecting'

// What a refused Done told us: `challengeWindow` is whether a browser was opened for the challenge,
// null when the answer carried no word on it.
export interface BlockedLogin {
  challengeWindow: boolean | null
}

export type AccountChip =
  | 'checking'
  | 'finishing'
  | 'unconfigured'
  | 'unverified'
  | 'connected'
  | 'expired'
  | 'disconnected'

// Which explanation sits beside an unverified chip: a window is open, none could open (use your own
// browser), or nothing is known about one (a status read after a reload).
export type AccountPanel = 'window' | 'own-browser' | 'unknown'

export interface AccountView {
  chip: AccountChip
  panel: AccountPanel | null
}

// The one decision behind the account chip and its panel. A token kept after a block reads as its own
// state, neither connected nor not: the last blocked answer picks the panel wording, and a status that
// says the site is verified (or the token gone) drops it.
export function accountView(
  phase: LoginPhase,
  status: AuthStatus | null,
  blocked: BlockedLogin | null,
): AccountView {
  if (phase === 'loading') return { chip: 'checking', panel: null }
  if (phase === 'pending' || phase === 'connecting' || phase === 'completing') {
    return { chip: 'finishing', panel: null }
  }
  if (status?.unconfigured) return { chip: 'unconfigured', panel: null }
  const stale = status !== null && !status.unverified
  if (status?.unverified || (blocked && !stale)) {
    const panel =
      blocked?.challengeWindow === true
        ? 'window'
        : blocked?.challengeWindow === false
          ? 'own-browser'
          : 'unknown'
    return { chip: 'unverified', panel }
  }
  if (status?.connected && !status.expired) return { chip: 'connected', panel: null }
  return { chip: status?.expired ? 'expired' : 'disconnected', panel: null }
}
