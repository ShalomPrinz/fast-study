import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  connectAuth,
  completeAuth,
  disconnectAuth,
  isBlockedError,
  isReconnectError,
} from '@/features/downloads/services/autoDownloader'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import {
  useMoodleLockState,
  useWithMoodleLock,
} from '@/features/downloads/contexts/MoodleLockContext'
import { moodleLocked } from '@/features/downloads/utils/moodleLock'
import { isMoodleBusyError } from '@/services/http'
import ConfirmModal from '@/shared/components/ConfirmModal'
import Icon from '@/shared/components/Icon'
import { toastFailure } from '@/shared/utils/failure'
import { toast } from '@/services/toaster'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import {
  loginFailure,
  moodleBusyMessage,
  toastBlocked,
} from '@/features/downloads/utils/downloadErrors'
import {
  accountView,
  captchaSeen,
  loginToast,
  type AccountPanel,
  type LoginPhase,
  type LoginToast,
} from '@/features/downloads/utils/accountView'
import './AccountStatus.css'
import '@/styles/chip.css'
import '@/styles/button.css'

// The university account as a header fact: one chip saying where the session stands, and the one button that
// can move it — Connect starts the login on the host and the chip follows the service's pushed state, Disconnect
// drops it.
export default function AccountStatus() {
  const { t } = useLingui()
  const { status, refresh } = useAuthStatus()
  const [phase, setPhase] = useState<LoginPhase>('loading')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const withMoodleLock = useWithMoodleLock()
  const lock = useMoodleLockState()

  // Probing from here rather than from the provider is what keeps the `reconnectKey` remount
  // meaningful: it re-runs this effect, and the shared status is replaced by a fresh answer.
  useEffect(() => {
    refresh().then(() => setPhase('idle'))
  }, [refresh])

  // The service says why (timed out, window closed, a site it refuses, a bot check).
  function toastLogin(toastKind: LoginToast | null, err?: unknown) {
    if (toastKind?.kind === 'reconnect') {
      toast('error', t`The login didn't finish. Press Connect and sign in again.`)
    } else if (toastKind?.kind === 'blocked') {
      toastBlocked(toastKind.challengeWindow)
    } else if (toastKind) {
      toast('error', serviceErrorNode(toastKind.failure))
    } else if (err !== undefined && !isMoodleBusyError(err)) {
      const failure = loginFailure(err)
      if (isBlockedError(err)) toastBlocked(err.challengeWindow)
      else if (failure) toast('error', serviceErrorNode(failure))
      else if (isReconnectError(err)) toastLogin({ kind: 'reconnect' })
      else toastFailure(err)
    }
  }

  const seen = useRef(status)
  useEffect(() => {
    toastLogin(loginToast(seen.current, status))
    seen.current = status
  }, [status])

  async function handleConnect() {
    setPhase('connecting')
    try {
      await withMoodleLock(connectAuth)
    } catch (err) {
      // A 429 only raced the push that disables this button.
      if (!isMoodleBusyError(err)) toastFailure(err)
    }
    setPhase('idle')
  }

  async function handleVerify() {
    setPhase('verifying')
    try {
      await withMoodleLock(completeAuth)
    } catch (err) {
      toastLogin(null, err)
    }
    setPhase('idle')
  }

  async function handleDisconnect() {
    setConfirmDisconnect(false)
    setPhase('disconnecting')
    try {
      await disconnectAuth()
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

  // Folded during render (React's adjust-state-on-prop-change), so the frame that drops the captcha reads it.
  const [seenCaptcha, setSeenCaptcha] = useState(false)
  const seenNow = captchaSeen(seenCaptcha, status)
  if (seenNow !== seenCaptcha) setSeenCaptcha(seenNow)
  const view = accountView(phase, status, seenNow)
  // An open challenge window holds the lock itself, and Complete (or a new Connect) is what it waits for.
  const locked = moodleLocked(lock, view.panel === 'window')
  const lockedTitle = locked ? moodleBusyMessage() : undefined

  if (view.chip === 'checking') {
    return (
      <span className="chip chip--neutral">
        <Trans>checking account…</Trans>
      </span>
    )
  }

  if (view.chip === 'finishing') {
    return (
      <span className="chip chip--warn">
        <Trans>finish login in the browser window</Trans>
      </span>
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
          <Trans>waiting for you to solve the captcha</Trans>
        </span>
        {view.panel !== 'solved' && (
          <button
            className="btn btn--ghost"
            onClick={handleVerify}
            disabled={phase === 'verifying' || locked}
            title={lockedTitle}
          >
            {verifyLabel(view.panel)}
          </button>
        )}
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
      <button
        className="btn btn--ghost"
        onClick={handleConnect}
        disabled={locked}
        title={lockedTitle}
      >
        {expired ? t`Reconnect` : t`Connect`}
      </button>
    </>
  )
}

// The verify button's label: a captcha on screen is solved, a closed one reopened, a passed window retried.
function verifyLabel(panel: AccountPanel | null) {
  if (panel === 'window') return <Trans>I solved the captcha</Trans>
  if (panel === 'closed') return <Trans>Open the captcha again</Trans>
  if (panel === 'ready') return <Trans>Try again</Trans>
  return <Trans>I confirmed, try again</Trans>
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
            A window opened on the university site. Solve the captcha there, and the connection
            finishes by itself.
          </Trans>
        )}
        {panel === 'solved' && <Trans>The captcha is solved. Finishing the connection…</Trans>}
        {panel === 'closed' && (
          <Trans>
            The window was closed before the captcha was solved. Press “Open the captcha again” to
            bring it back.
          </Trans>
        )}
        {panel === 'ready' && (
          <Trans>
            The window on the university site passed, with no captcha to solve. Press “Try again”.
          </Trans>
        )}
        {panel === 'own-browser' && (
          <Trans>
            Open the university site in your browser and solve the captcha there, then press “I
            confirmed, try again”.
          </Trans>
        )}
        {panel === 'unknown' && (
          <Trans>
            Use the window that opened on the university site, or open the site in your browser, and
            solve the captcha there. Then press “I confirmed, try again”.
          </Trans>
        )}
      </p>
    </div>
  )
}
