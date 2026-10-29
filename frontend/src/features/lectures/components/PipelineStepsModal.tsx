import { useEffect } from 'react'
import type { ReactNode } from 'react'
import ReactDOM from 'react-dom'
import { Trans } from '@lingui/react/macro'
import '@/styles/pipeline-card.css'
import './PipelineStepsModal.css'

interface Props {
  children: ReactNode
  onClose: () => void
  // False while a confirm sits above, so its Escape closes only itself.
  closeOnEscape: boolean
}

// The full pipeline rows in a panel with one floating Close below it; a backdrop click or Escape closes too.
export default function PipelineStepsModal({ children, onClose, closeOnEscape }: Props) {
  useEffect(() => {
    if (!closeOnEscape) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, closeOnEscape])

  return ReactDOM.createPortal(
    <div className="steps-modal-overlay" onClick={onClose}>
      <div
        className="steps-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="steps-modal-title"
        data-testid="pipeline-steps-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="steps-modal-title" id="steps-modal-title">
          <Trans>Pipeline steps</Trans>
        </h2>
        <div className="pipeline-card lecture-pipeline">{children}</div>
      </div>
      <button
        className="steps-modal-close"
        data-testid="pipeline-steps-close"
        autoFocus
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <Trans>Close</Trans>
      </button>
    </div>,
    document.body,
  )
}
