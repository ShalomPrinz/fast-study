import { Trans } from '@lingui/react/macro'
import AccountStatus from '@/features/downloads/components/AccountStatus'
import '@/styles/settings-form.css'
import './MoodleAccountField.css'

// The BIU account beside the browser check, in the same field vocabulary. It never blocks: nothing
// here reaches `missingEntries` or `isInitialized`, and an unconnected account costs only the
// downloads page, which gates itself. See docs/SETTINGS.md.
export default function MoodleAccountField() {
  return (
    <div className="settings-field" id="moodle-account">
      {/* No `<label>`: the control is a chip and a button, with nothing to focus. */}
      <div className="settings-label">
        <span>
          <Trans>BIU account</Trans>
        </span>
      </div>
      <p className="settings-hint">
        <Trans>
          Fast Study signs in to your course site with this account to find and fetch recordings.
          Nothing else needs it, and you can connect it later.
        </Trans>
      </p>
      <div className="moodle-account-control">
        <AccountStatus />
      </div>
    </div>
  )
}
