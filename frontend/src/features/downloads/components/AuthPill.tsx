import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { AuthStatus } from '@/features/downloads/services/autoDownloader'
import {
  fetchAuthStatus,
  connectAuth,
  completeAuth,
} from '@/features/downloads/services/autoDownloader'
import { toast } from '@/services/toaster'
import './AuthPill.css'

type Phase = 'loading' | 'idle' | 'connecting' | 'pending' | 'completing'

// Connect pops a headed browser on the host for MFA; Done persists the session.
export default function AuthPill() {
  const { t } = useLingui()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')

  async function refresh() {
    try {
      setStatus(await fetchAuthStatus())
    } catch {
      // Connection errors are toasted centrally.
      setStatus(null)
    }
  }

  useEffect(() => {
    refresh().then(() => setPhase('idle'))
  }, [])

  async function handleConnect() {
    setPhase('connecting')
    try {
      await connectAuth()
      setPhase('pending')
    } catch {
      toast('error', t`Failed to launch the login browser.`)
      setPhase('idle')
    }
  }

  async function handleComplete() {
    setPhase('completing')
    try {
      await completeAuth()
      await refresh()
    } catch {
      toast('error', t`Failed to complete login. Try reconnecting.`)
    }
    setPhase('idle')
  }

  if (phase === 'loading') {
    return (
      <div className="auth-pill auth-pill--muted">
        <Trans>checking account…</Trans>
      </div>
    )
  }

  if (phase === 'pending' || phase === 'connecting' || phase === 'completing') {
    const busy = phase !== 'pending'
    return (
      <div className="auth-pill auth-pill--pending">
        <span>
          <Trans>finish login in the browser window</Trans>
        </span>
        <button className="auth-pill-btn" onClick={handleComplete} disabled={busy}>
          {phase === 'completing' ? t`finishing…` : t`Done`}
        </button>
      </div>
    )
  }

  const expired = status?.expired
  if (status?.connected && !expired) {
    return (
      <div className="auth-pill auth-pill--connected">
        <Trans>BIU account connected ✓</Trans>
      </div>
    )
  }

  const label = expired ? t`session expired` : t`not connected`
  const action = expired ? t`Reconnect` : t`Connect`
  return (
    <div className="auth-pill auth-pill--disconnected">
      <span>{label}</span>
      <button className="auth-pill-btn" onClick={handleConnect}>
        {action}
      </button>
    </div>
  )
}
