import { useState, type ReactNode } from 'react'
import { Trans } from '@lingui/react/macro'
import PrivacyPolicyModal from './PrivacyPolicyModal'
import '@/styles/chip.css'
import '@/styles/settings-form.css'
import './ErrorReportsField.css'

interface Props {
  value: boolean
  // Whether the privacy policy was answered, either way.
  confirmed: boolean
  onChange: (value: boolean) => void
  // The policy's answer: Confirm turns reports on, Decline off, and both mark it answered.
  onAnswer: (confirmed: boolean) => void
  // A screen's own line under the switch: the wall's must-read note, Settings' restart notice.
  notice?: ReactNode
}

// The error-reporting switch with its privacy policy. The hint claims only what lib/sentry scrubs.
export default function ErrorReportsField({ value, confirmed, onChange, onAnswer, notice }: Props) {
  const [reading, setReading] = useState(false)
  return (
    <div className="settings-field">
      <label className="settings-check">
        <input
          id="error-reports"
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="settings-check-text">
          <span>
            <Trans>Send error reports</Trans>
          </span>
          <span className="settings-hint">
            <Trans>
              Only technical error details are sent, never your files or keys. It's anonymous, and
              it helps us improve FastStudy.
            </Trans>
          </span>
        </span>
      </label>
      <div className="error-reports-privacy">
        <button
          type="button"
          className="settings-link error-reports-policy"
          onClick={() => setReading(true)}
        >
          <Trans>Privacy policy</Trans>
        </button>
        {confirmed ? (
          <span className="chip chip--ok" data-privacy-mark="confirmed">
            <Trans context="privacy policy">Confirmed ✓</Trans>
          </span>
        ) : (
          <span className="chip chip--neutral" data-privacy-mark="unconfirmed">
            <Trans context="privacy policy">Not confirmed yet</Trans>
          </span>
        )}
      </div>
      {notice}
      {reading && (
        <PrivacyPolicyModal
          onAnswer={(answer) => {
            setReading(false)
            onAnswer(answer)
          }}
          onClose={() => setReading(false)}
        />
      )}
    </div>
  )
}
