import { Trans, useLingui } from '@lingui/react/macro'
import '@/styles/settings-form.css'

export interface DriveValue {
  enabled: boolean
  folder: string
}

interface Props {
  value: DriveValue
  onChange: (value: DriveValue) => void
  folderMissing: boolean
}

// The Drive toggle and the folder it needs. The consequence of turning Drive back on is stated
// here, where it is flipped, rather than discovered when the backlog starts uploading.
export default function DriveFields({ value, onChange, folderMissing }: Props) {
  const { t } = useLingui()

  return (
    <div className="settings-field">
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        <span className="settings-check-text">
          <span>
            <Trans>Upload finished summaries to Google Drive</Trans>
          </span>
          <span className="settings-hint">
            <Trans>
              With this off, a lecture is finished once its PDF is ready. Turning it back on marks
              every lecture that finished meanwhile as unfinished again, and they will all upload.
            </Trans>
          </span>
        </span>
      </label>

      {value.enabled && (
        <>
          <div className="settings-label">
            <label htmlFor="gdrive-folder">
              <Trans>Drive folder name</Trans>
            </label>
            {folderMissing && (
              <span className="settings-required">
                <Trans>Required</Trans>
              </span>
            )}
          </div>
          <input
            id="gdrive-folder"
            className={`settings-input${folderMissing ? ' settings-input--invalid' : ''}`}
            value={value.folder}
            placeholder={t`Fast Study`}
            onChange={(e) => onChange({ ...value, folder: e.target.value })}
          />
          <p className="settings-hint">
            <Trans>
              The folder in your Drive that summaries are uploaded into. It is created if it does
              not exist yet.
            </Trans>
          </p>
        </>
      )}
    </div>
  )
}
