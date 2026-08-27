import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { AuthStatus } from '@/features/downloads/services/autoDownloader'
import {
  fetchAuthStatus,
  connectAuth,
  completeAuth,
} from '@/features/downloads/services/autoDownloader'
import Icon from '@/shared/components/Icon'
import { toast } from '@/services/toaster'
import '@/styles/chip.css'
import '@/styles/button.css'

type Phase = 'loading' | 'idle' | 'connecting' | 'pending' | 'completing'

// The BIU account as a header fact: one chip saying where the session stands, and the one button
// that can move it. Connect pops a headed browser on the host for MFA; Done persists the session.
export default function AccountStatus() {
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
      <span className="chip chip--neutral">
        <Trans>checking account…</Trans>
      </span>
    )
  }

  if (phase === 'pending' || phase === 'connecting' || phase === 'completing') {
    return (
      <>
        <span className="chip chip--warn">
          <Trans>finish login in the browser window</Trans>
        </span>
        <button className="btn btn--ghost" onClick={handleComplete} disabled={phase !== 'pending'}>
          {phase === 'completing' ? t`finishing…` : t`Done`}
        </button>
      </>
    )
  }

  const expired = status?.expired
  if (status?.connected && !expired) {
    return (
      <>
        <span className="chip chip--ok">
          <Icon icon="check" />
          <Trans>BIU account connected</Trans>
        </span>
        <button className="btn btn--ghost" onClick={handleConnect}>
          <Trans>Manage account</Trans>
        </button>
      </>
    )
  }

  return (
    <>
      <span className={expired ? 'chip chip--warn' : 'chip chip--danger'}>
        {expired ? t`session expired` : t`not connected`}
      </span>
      <button className="btn btn--ghost" onClick={handleConnect}>
        {expired ? t`Reconnect` : t`Connect`}
      </button>
    </>
  )
}
