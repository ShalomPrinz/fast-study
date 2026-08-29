import { Trans, useLingui } from '@lingui/react/macro'
import '@/styles/settings-form.css'

interface Props {
  value: string
  onChange: (value: string) => void
  // Both present only on the init wall, where a prefilled root is confirmed rather than accepted.
  confirmed?: boolean
  onConfirmedChange?: (confirmed: boolean) => void
}

// Where every course, lecture, video and summary is kept on this machine.
export default function DataRootField({ value, onChange, confirmed, onConfirmedChange }: Props) {
  const { t } = useLingui()

  return (
    <div className="settings-field">
      <div className="settings-label">
        <label htmlFor="data-root">
          <Trans>Data folder</Trans>
        </label>
      </div>
      <p className="settings-hint">
        <Trans>
          Every course, lecture, video and summary is stored here. Use a folder on this computer
          that is not synced to the cloud.
        </Trans>
      </p>
      <input
        id="data-root"
        className="settings-input settings-input--code"
        value={value}
        spellCheck={false}
        placeholder={t`C:\\Users\\you\\AppData\\Local\\FastStudy\\data`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="settings-note">
        <Trans>
          Changing this re-points the app only — it never moves anything. The old folder stays
          exactly as it is, and pointing back here brings it all back.
        </Trans>
      </p>
      {onConfirmedChange && (
        <label className="settings-check">
          <input
            type="checkbox"
            checked={confirmed ?? false}
            onChange={(e) => onConfirmedChange(e.target.checked)}
          />
          <span className="settings-check-text">
            <Trans>Yes, store my lectures in this folder</Trans>
          </span>
        </label>
      )}
    </div>
  )
}
