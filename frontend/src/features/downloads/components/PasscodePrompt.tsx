import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import ReactDOM from 'react-dom'
import type { PasscodeError } from '@/features/downloads/services/autoDownloader'
import '@/styles/modal.css'
import '@/styles/source-row.css'
import './PasscodePrompt.css'

export interface PasscodePromptProps {
  reason: PasscodeError['reason']
  busy: boolean
  onSubmit: (passcode: string, scope: 'course' | 'lecture') => void
  onCancel: () => void
}

// Masked passcode modal — ConfirmModal's portal/Escape shape, which can't host an input.
// The parent unmounts it between openings, so a re-prompt mounts fresh with an empty field.
export default function PasscodePrompt({ reason, busy, onSubmit, onCancel }: PasscodePromptProps) {
  const { t } = useLingui()
  const [value, setValue] = useState('')
  const [justThisLecture, setJustThisLecture] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const message =
    reason === 'incorrect'
      ? t`That passcode didn't work. Try another one`
      : t`Enter the zoom passcode for this recording`

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-message">{message}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(value.trim(), justThisLecture ? 'lecture' : 'course')
          }}
        >
          <input
            className="source-row-input passcode-input"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t`Passcode`}
            dir="ltr"
            autoFocus
          />
          <label className="passcode-scope">
            <input
              type="checkbox"
              checked={justThisLecture}
              onChange={(e) => setJustThisLecture(e.target.checked)}
            />
            <Trans>just this lecture</Trans>
          </label>
          <div className="modal-actions">
            <button type="button" className="modal-btn modal-btn--no" onClick={onCancel}>
              <Trans>Cancel</Trans>
            </button>
            <button type="submit" className="modal-btn" disabled={busy || !value.trim()}>
              <Trans>Submit</Trans>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
