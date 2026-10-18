import React, { useEffect } from 'react'
import { Trans } from '@lingui/react/macro'
import ReactDOM from 'react-dom'
import Tooltip from './Tooltip'
import '@/styles/modal.css'
import '@/styles/button.css'
import './ConfirmModal.css'

interface Props {
  message: string
  postMessage?: string
  warning?: string
  detail?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
  // Set, Yes is disabled with this as its hint — the action it would replay is refused right now.
  confirmLocked?: string
}

export default function ConfirmModal({
  message,
  postMessage,
  warning,
  detail,
  onConfirm,
  onCancel,
  confirmLocked,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-message">{message}</p>
        {warning && <p className="modal-warning">{warning}</p>}
        {detail}
        {postMessage && <p className="modal-message modal-note">{postMessage}</p>}
        <div className="modal-actions">
          <Tooltip content={confirmLocked}>
            <button className="btn btn--primary" onClick={onConfirm} disabled={!!confirmLocked}>
              <Trans>Yes</Trans>
            </button>
          </Tooltip>
          <button className="btn btn--ghost" autoFocus onClick={onCancel}>
            <Trans>No</Trans>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
