import { Trans } from '@lingui/react/macro'
import '@/styles/settings-form.css'

interface Props {
  value: boolean
  onChange: (value: boolean) => void
  // Whether to say a change waits for the next launch, as `/settings` does.
  restartNote: boolean
}

// The error-reporting switch. The hint claims only what lib/sentry's scrubber actually removes.
export default function ErrorReportsField({ value, onChange, restartNote }: Props) {
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
              Anonymous crash reports and recent app logs go to Sentry to help fix bugs, with folder
              paths, Hebrew text, user names and keys removed first.
            </Trans>
          </span>
          {restartNote && (
            <span className="settings-hint">
              <Trans>A change takes effect the next time you open Fast Study.</Trans>
            </span>
          )}
        </span>
      </label>
    </div>
  )
}
