import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import type { PasscodeError } from './services/autoDownloader'

interface PasscodePromptProps {
  reason: PasscodeError['reason']
  busy: boolean
  onSubmit: (passcode: string, scope: 'course' | 'lecture') => void
  onCancel: () => void
}

// Masked-input modal for a zoom passcode. Mirrors ConfirmModal's portal + Escape/overlay-cancel
// shape (ConfirmModal can't host an input). Owns the input + scope state so the parent only sees
// the final (passcode, scope) on submit; the parent unmounts it between openings, so a wrong-
// passcode re-prompt mounts fresh with an empty field. Default scope is course-wide; "just this
// lecture" narrows it to this recording.
export default function PasscodePrompt({ reason, busy, onSubmit, onCancel }: PasscodePromptProps) {
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
      ? "That passcode didn't work. Try another one"
      : 'Enter the zoom passcode for this recording'

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
            placeholder="Passcode"
            dir="ltr"
            autoFocus
          />
          <label className="passcode-scope">
            <input
              type="checkbox"
              checked={justThisLecture}
              onChange={(e) => setJustThisLecture(e.target.checked)}
            />
            just this lecture
          </label>
          <div className="modal-actions">
            <button type="button" className="modal-btn modal-btn--no" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="modal-btn" disabled={busy || !value.trim()}>
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
