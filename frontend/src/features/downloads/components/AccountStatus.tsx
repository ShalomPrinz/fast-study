import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  connectAuth,
  completeAuth,
  disconnectAuth,
} from '@/features/downloads/services/autoDownloader'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import Icon from '@/shared/components/Icon'
import { toastFailure } from '@/shared/utils/failure'
import { toast } from '@/services/toaster'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import { loginFailure } from '@/features/downloads/utils/downloadErrors'
import { isBlockedError, isReconnectError } from '@/features/downloads/services/autoDownloader'
import {
  accountView,
  type AccountPanel,
  type BlockedLogin,
  type LoginPhase,
} from '@/features/downloads/utils/accountView'
import './AccountStatus.css'
import '@/styles/chip.css'
import '@/styles/button.css'

// The university account as a header fact: one chip saying where the session stands, and the one button that
// can move it — Connect pops a headed browser for MFA, Done persists the session, Disconnect drops it.
export default function AccountStatus() {
  const { t } = useLingui()
  const { status, refresh } = useAuthStatus()
  const [phase, setPhase] = useState<LoginPhase>('loading')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [blocked, setBlocked] = useState<BlockedLogin | null>(null)

  // Probing from here rather than from the provider is what keeps the `reconnectKey` remount
  // meaningful: it re-runs this effect, and the shared status is replaced by a fresh answer.
  useEffect(() => {
    refresh().then(() => setPhase('idle'))
  }, [refresh])

  async function handleConnect() {
    setPhase('connecting')
    setBlocked(null)
    try {
      await connectAuth()
      setPhase('pending')
    } catch (err) {
      toastFailure(err)
      setPhase('idle')
    }
  }

  async function handleComplete() {
    setPhase('completing')
    try {
      await completeAuth()
      setBlocked(null)
      await refresh()
    } catch (err) {
      if (isBlockedError(err)) {
        // The token was kept: the status now reads unverified, and the panel says what to do.
        setBlocked({ challengeWindow: err.challengeWindow })
        await refresh()
      } else if (isReconnectError(err)) {
        // No login was captured, which is not an expired session: log in again.
        setBlocked(null)
        await refresh()
        toast('error', t`The login didn't finish. Press Connect and sign in again.`)
        setPhase('idle')
        return
      }
      // The service says why (timed out, window closed, nothing pending, a site it refuses).
      const failure = loginFailure(err)
      if (typeof failure === 'string') toast('error', failure)
      else if (failure) toast('error', serviceErrorNode(failure))
      else toastFailure(err)
    }
    setPhase('idle')
  }

  async function handleDisconnect() {
    setConfirmDisconnect(false)
    setPhase('disconnecting')
    try {
      await disconnectAuth()
      setBlocked(null)
      await refresh()
    } catch (err) {
      toastFailure(err)
    }
    setPhase('idle')
  }

  const disconnectModal = () => (
    <ConfirmModal
      message={t`Disconnect the university account?`}
      warning={t`Connecting again needs a full login in a browser window, including two-step verification.`}
      onConfirm={handleDisconnect}
      onCancel={() => setConfirmDisconnect(false)}
    />
  )

  const view = accountView(phase, status, blocked)

  if (view.chip === 'checking') {
    return (
      <span className="chip chip--neutral">
        <Trans>checking account…</Trans>
      </span>
    )
  }

  if (view.chip === 'finishing') {
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

  // Nothing to connect to: the chip says what is missing, and Settings is where it is chosen.
  if (view.chip === 'unconfigured') {
    return (
      <span className="chip chip--neutral">
        <Trans>no university chosen</Trans>
      </span>
    )
  }

  if (view.chip === 'unverified') {
    return (
      <>
        <span className="chip chip--warn" data-account="unverified">
          <Trans>checking the connection</Trans>
        </span>
        <button className="btn btn--ghost" onClick={handleComplete}>
          <Trans>Done</Trans>
        </button>
        <button className="btn btn--ghost" onClick={() => setConfirmDisconnect(true)}>
          <Trans>Disconnect</Trans>
        </button>
        {view.panel && <BlockedPanel panel={view.panel} />}
        {confirmDisconnect && disconnectModal()}
      </>
    )
  }

  const expired = view.chip === 'expired'
  if (view.chip === 'connected') {
    return (
      <>
        <span className="chip chip--ok">
          <Icon icon="check" />
          <Trans>University account connected</Trans>
        </span>
        <button
          className="btn btn--ghost"
          onClick={() => setConfirmDisconnect(true)}
          disabled={phase === 'disconnecting'}
        >
          {phase === 'disconnecting' ? t`disconnecting…` : t`Disconnect`}
        </button>
        {confirmDisconnect && disconnectModal()}
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

// Why the account is not verified yet and what finishes it; the toast says the same in a line, this stays.
function BlockedPanel({ panel }: { panel: AccountPanel }) {
  return (
    <div className="account-panel" role="status">
      <p>
        <Trans>The university is checking the connection.</Trans>
      </p>
      <p>
        {panel === 'window' && (
          <Trans>
            A window opened on the university site. Confirm there that you are not a bot, then press
            Done again.
          </Trans>
        )}
        {panel === 'own-browser' && (
          <Trans>
            Open the university site in your browser and confirm there that you are not a bot, then
            press Done again.
          </Trans>
        )}
        {panel === 'unknown' && (
          <Trans>
            Use the window that opened on the university site, or open the site in your browser, and
            confirm there that you are not a bot. Then press Done again.
          </Trans>
        )}
      </p>
    </div>
  )
}
