import { useEffect } from 'react'
import ReactDOM from 'react-dom'

interface Props {
  message: string
  warning?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ message, warning, onConfirm, onCancel }: Props) {
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
        <div className="modal-actions">
          <button className="modal-btn modal-btn--yes" onClick={onConfirm}>Yes</button>
          <button className="modal-btn modal-btn--no" autoFocus onClick={onCancel}>No</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
