import { Trans, useLingui } from '@lingui/react/macro'
import type { AutoRemoveAfter } from '@/services/settings'
import {
  AUTO_REMOVE_CHECKED,
  type AutoRemoveApply,
  type AutoRemoveForm,
  type RemoveWhat,
} from '../utils/autoRemove'
import '@/styles/settings-form.css'
import '@/styles/button.css'
import './AutoRemoveField.css'

interface Props {
  value: AutoRemoveForm
  onChange: (value: AutoRemoveForm) => void
  // The form's Drive toggle, not the stored one: "after Drive" follows what the page is about to save.
  driveEnabled: boolean
  // What Apply would do (`autoRemoveApply`); `null` while busy or with nothing to do disables it.
  apply: AutoRemoveApply
  onApply: () => void
}

// The opt-in that deletes a finished lecture's video (and audio) from disk. It saves through its own
// Apply, or the page's Save, which treats it the same way. See docs/SETTINGS.md.
export default function AutoRemoveField({ value, onChange, driveEnabled, apply, onApply }: Props) {
  const { t } = useLingui()
  const whatOptions: { id: RemoveWhat; label: string }[] = [
    { id: 'video', label: t`Video` },
    { id: 'audio', label: t`Video and audio` },
  ]
  const afterOptions: { id: AutoRemoveAfter; label: string; disabled: boolean }[] = [
    { id: 'pdf', label: t`After the PDF is created`, disabled: false },
    { id: 'drive', label: t`After the PDF is uploaded to Drive`, disabled: !driveEnabled },
  ]

  return (
    <div className="settings-field auto-remove" id="auto-remove">
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.on}
          // Unchecked to checked always starts from the defaults, never from a previous choice.
          onChange={(e) =>
            onChange(e.target.checked ? AUTO_REMOVE_CHECKED : { ...value, on: false })
          }
        />
        <span className="settings-check-text">
          <span>
            <Trans>Auto-remove files from computer</Trans>
          </span>
          <span className="settings-hint">
            <Trans>
              Frees up disk space once a lecture is finished. The transcript, the summary and the
              PDF are always kept.
            </Trans>
          </span>
        </span>
      </label>

      {value.on && (
        <div className="auto-remove-choices">
          <fieldset className="auto-remove-group">
            <legend className="settings-label">
              <Trans>What to remove</Trans>
            </legend>
            {whatOptions.map(({ id, label }) => (
              <label key={id} className="settings-check">
                <input
                  type="radio"
                  name="auto-remove-what"
                  checked={value.what === id}
                  onChange={() => onChange({ ...value, what: id })}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="auto-remove-group">
            <legend className="settings-label">
              <Trans>When to remove</Trans>
            </legend>
            {afterOptions.map(({ id, label, disabled }) => (
              <label
                key={id}
                className={`settings-check${disabled ? ' auto-remove-option--disabled' : ''}`}
              >
                <input
                  type="radio"
                  name="auto-remove-after"
                  checked={value.after === id}
                  disabled={disabled}
                  onChange={() => onChange({ ...value, after: id })}
                />
                <span className="settings-check-text">
                  <span>{label}</span>
                  {disabled && (
                    <span className="settings-hint">
                      <Trans>Turn on the Google Drive upload above to choose this.</Trans>
                    </span>
                  )}
                </span>
              </label>
            ))}
            {value.after === null && (
              <span className="settings-hint" data-auto-remove="choose-when">
                <Trans>Choose when the files are removed.</Trans>
              </span>
            )}
          </fieldset>
        </div>
      )}

      <div className="auto-remove-apply">
        {apply === 'needs-page-save' && (
          <span className="settings-hint" data-auto-remove="needs-page-save">
            <Trans>
              Drive upload isn't saved yet. Use Save at the top of the page to save both.
            </Trans>
          </span>
        )}
        <button
          className="btn btn--ghost"
          disabled={apply !== 'save' && apply !== 'sweep'}
          onClick={onApply}
        >
          <Trans>Apply</Trans>
        </button>
      </div>
    </div>
  )
}
