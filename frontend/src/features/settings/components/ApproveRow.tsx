import type { KeyboardEvent, ReactNode } from 'react'
import { Trans } from '@lingui/react/macro'
import '@/styles/button.css'
import './ApproveRow.css'

interface Props {
  id: string
  // An unsaved edit exists; the button is hidden until then.
  visible: boolean
  // The edit cannot be saved yet (blank or invalid), so Approve waits.
  disabled: boolean
  onApprove: () => void
  children: ReactNode
}

// A typed or sensitive entry and its Approve button; Enter in a text box approves too.
export default function ApproveRow({ id, visible, disabled, onApprove, children }: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLInputElement
    if (e.key !== 'Enter' || e.defaultPrevented || target.tagName !== 'INPUT') return
    if (target.type === 'checkbox' || target.readOnly) return
    e.preventDefault()
    if (visible && !disabled) onApprove()
  }
  return (
    <div className="approve-row" onKeyDown={onKeyDown}>
      {children}
      {visible && (
        <button
          type="button"
          className="btn btn--primary approve-row-button"
          data-approve={id}
          disabled={disabled}
          onClick={onApprove}
        >
          <Trans>Approve</Trans>
        </button>
      )}
    </div>
  )
}
