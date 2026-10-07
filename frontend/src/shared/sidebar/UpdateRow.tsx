import { Trans, useLingui } from '@lingui/react/macro'
import ReactDOM from 'react-dom'
import Icon from '@/shared/components/Icon'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useRestartToUpdate, useUpdateState } from '@/shared/hooks/useAppUpdate'
import '@/styles/spinner.css'
import '@/styles/button.css'
import '@/styles/modal.css'
import './UpdateRow.css'

// The footer's update row: hidden until the launcher has an update downloading or downloaded.
// `busy` means a restart would kill running work, so Restart now asks first.
export default function UpdateRow({ busy }: { busy: boolean }) {
  const { t } = useLingui()
  const state = useUpdateState()
  const { restarting, confirming, request, confirm, cancel } = useRestartToUpdate(busy)

  if (state === null) return null

  if (state === 'downloading') {
    return (
      <div className="sidebar-update sidebar-update--downloading">
        <span className="spinner spinner--sm" aria-hidden />
        <span className="sidebar-update-text">
          <Trans>Downloading update…</Trans>
        </span>
      </div>
    )
  }

  return (
    <div className="sidebar-update sidebar-update--downloaded">
      <div className="sidebar-update-line">
        <span className="sidebar-update-done">
          <Icon icon="check" />
        </span>
        <span className="sidebar-update-text">
          <Trans>Updated. Restart to update</Trans>
        </span>
      </div>
      <button
        className="btn btn--primary sidebar-update-restart"
        disabled={restarting}
        onClick={request}
      >
        {restarting ? <Trans>Loading…</Trans> : <Trans>Restart now</Trans>}
      </button>
      {confirming && (
        <ConfirmModal
          message={t`Work in progress will stop. Restart anyway?`}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
      {/* Blocks the whole window while the launcher kills the services and installs. */}
      {restarting &&
        ReactDOM.createPortal(<div className="modal-overlay update-overlay" />, document.body)}
    </div>
  )
}
