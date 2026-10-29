import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { COUNT_RANGE, MINUTES_RANGE, parseRetryInt, type AutoRetryForm } from '../utils/autoRetry'
import '@/styles/settings-form.css'

// A number box that only ever holds a value the store accepts: a half-typed or out-of-range entry
// is shown but not committed, and the box falls back to the last good value on blur.
function IntInput({
  id,
  value,
  range,
  disabled,
  onChange,
}: {
  id: string
  value: number
  range: { min: number; max: number }
  disabled: boolean
  onChange: (n: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      className="settings-input"
      min={range.min}
      max={range.max}
      step={1}
      disabled={disabled}
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseRetryInt(e.target.value, range)
        if (n !== null) onChange(n)
      }}
      onBlur={() => setText(null)}
    />
  )
}

export default function AutoRetryField({
  value,
  onChange,
}: {
  value: AutoRetryForm
  onChange: (v: AutoRetryForm) => void
}) {
  return (
    <>
      <div className="settings-field">
        <label className="settings-check">
          <input
            id="auto-retry"
            type="checkbox"
            checked={value.on}
            onChange={(e) => onChange({ ...value, on: e.target.checked })}
          />
          <span className="settings-check-text">
            <span>
              <Trans>Retry automatically when Gemini is busy or unreachable</Trans>
            </span>
          </span>
        </label>
        <span className="settings-hint">
          <Trans>
            A summary or assignment step that fails on a temporary Gemini problem runs again on its
            own, and you can cancel the wait. A used-up daily quota is never retried.
          </Trans>
        </span>
      </div>
      <div className="settings-field">
        <div className="settings-label">
          <label htmlFor="auto-retry-count">
            <Trans>Number of retries</Trans>
          </label>
        </div>
        <IntInput
          id="auto-retry-count"
          value={value.count}
          range={COUNT_RANGE}
          disabled={!value.on}
          onChange={(count) => onChange({ ...value, count })}
        />
      </div>
      <div className="settings-field">
        <div className="settings-label">
          <label htmlFor="auto-retry-minutes">
            <Trans>Minutes between retries</Trans>
          </label>
        </div>
        <IntInput
          id="auto-retry-minutes"
          value={value.minutes}
          range={MINUTES_RANGE}
          disabled={!value.on}
          onChange={(minutes) => onChange({ ...value, minutes })}
        />
      </div>
    </>
  )
}
