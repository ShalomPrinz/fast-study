import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { AuthStatus } from '@/features/downloads/services/autoDownloader'
import {
  fetchAuthStatus,
  connectAuth,
  completeAuth,
  disconnectAuth,
} from '@/features/downloads/services/autoDownloader'
import ConfirmModal from '@/shared/components/ConfirmModal'
import Icon from '@/shared/components/Icon'
import { toast } from '@/services/toaster'
import '@/styles/chip.css'
import '@/styles/button.css'

type Phase = 'loading' | 'idle' | 'connecting' | 'pending' | 'completing' | 'disconnecting'

// The BIU account as a header fact: one chip saying where the session stands, and the one button that
// can move it — Connect pops a headed browser for MFA, Done persists the session, Disconnect drops it.
export default function AccountStatus() {
  const { t } = useLingui()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

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

  async function handleDisconnect() {
    setConfirmDisconnect(false)
    setPhase('disconnecting')
    try {
      await disconnectAuth()
      await refresh()
    } catch {
      toast('error', t`Failed to disconnect the account.`)
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
        <button
          className="btn btn--ghost"
          onClick={() => setConfirmDisconnect(true)}
          disabled={phase === 'disconnecting'}
        >
          {phase === 'disconnecting' ? t`disconnecting…` : t`Disconnect`}
        </button>
        {confirmDisconnect && (
          <ConfirmModal
            message={t`Disconnect the BIU account?`}
            warning={t`Connecting again needs a full login in a browser window, including MFA.`}
            onConfirm={handleDisconnect}
            onCancel={() => setConfirmDisconnect(false)}
          />
        )}
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
