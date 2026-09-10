import { useCallback, useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { connectDrive, disconnectDrive, fetchDriveStatus, type DriveStatus } from '@/services/drive'
import { openExternalUrl } from '@/services/open'
import Icon from '@/shared/components/Icon'
import { useNotify } from '@/shared/hooks/useNotify'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/settings-form.css'
import './DriveConnection.css'

type State = 'unknown' | 'pending' | 'connected' | 'disconnected'

function stateOf(status: DriveStatus | null): State {
  if (!status) return 'unknown'
  if (status.pending) return 'pending'
  return status.connected ? 'connected' : 'disconnected'
}

// The Google account summaries upload to: one chip and the single button that can move it. A failure
// fills the field's own status slot rather than a toast — the init wall renders outside the toast
// container. See docs/SETTINGS.md.
export default function DriveConnection() {
  const { t } = useLingui()
  const [status, setStatus] = useState<DriveStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchDriveStatus())
    } catch {
      // A downed backend is toasted centrally; the field only stops claiming a state.
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])
  // A landed token, a flow that failed or timed out and a disconnect all push; `pending` does not.
  useNotify(refresh)

  async function connect() {
    setBusy(true)
    setFailure('')
    try {
      await connectDrive()
      // The one transition the backend does not push, so its caller records it here.
      setStatus((s) => ({ ...(s ?? { connected: false, consentNeeded: false }), pending: true }))
    } catch (err) {
      setFailure((err as Error).message)
    }
    setBusy(false)
  }

  async function reopen() {
    setFailure('')
    try {
      // Connecting again while a flow is pending answers its URL rather than starting a rival flow.
      await openExternalUrl(await connectDrive())
    } catch (err) {
      setFailure((err as Error).message)
    }
  }

  async function disconnect() {
    setBusy(true)
    setFailure('')
    try {
      await disconnectDrive()
      await refresh()
    } catch (err) {
      setFailure((err as Error).message)
    }
    setBusy(false)
  }

  const state = stateOf(status)

  return (
    <div className={`settings-field drive-connection--${state}`} id="drive-connection">
      {/* No `<label>`: the control is a chip and a button, with nothing to focus. */}
      <div className="settings-label">
        <span>
          <Trans>Google account</Trans>
        </span>
      </div>
      <p className="settings-hint">
        <Trans>
          Summaries upload to this account's Drive. Connecting opens a Google sign-in page in your
          browser, and you can do it later — nothing else needs it.
        </Trans>
      </p>
      <div className="drive-connection-control">
        {state === 'unknown' && (
          <span className="chip chip--neutral">
            <Trans>checking Drive…</Trans>
          </span>
        )}
        {state === 'pending' && (
          <>
            <span className="chip chip--warn">
              <Trans>finish signing in to Google</Trans>
            </span>
            <button className="btn btn--ghost" onClick={() => void reopen()}>
              <Trans>Open the sign-in page</Trans>
              <Icon icon="external-link" />
            </button>
          </>
        )}
        {state === 'connected' && (
          <>
            <span className="chip chip--ok">
              <Icon icon="check" />
              <Trans>Drive connected</Trans>
            </span>
            <button className="btn btn--ghost" disabled={busy} onClick={() => void disconnect()}>
              {busy ? t`disconnecting…` : t`Disconnect`}
            </button>
          </>
        )}
        {state === 'disconnected' && (
          <>
            <span className="chip chip--neutral">
              <Trans>not connected</Trans>
            </span>
            <button className="btn btn--ghost" disabled={busy} onClick={() => void connect()}>
              {busy ? t`connecting…` : t`Connect`}
            </button>
          </>
        )}
      </div>
      {failure && (
        <p className="settings-status settings-status--danger" id="drive-connection-failure">
          {failure}
        </p>
      )}
    </div>
  )
}
