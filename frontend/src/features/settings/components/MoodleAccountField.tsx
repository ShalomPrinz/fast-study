import { Trans } from '@lingui/react/macro'
import AccountStatus from '@/features/downloads/components/AccountStatus'
import '@/styles/settings-form.css'
import './MoodleAccountField.css'

interface Props {
  // The saved site; the account always belongs to it, never to an unsaved choice in the form.
  site: string | null
  // The form holds another site: connecting now would sign in to the one about to be replaced.
  switching: boolean
}

function hostOf(site: string): string {
  try {
    return new URL(site).host
  } catch {
    return site
  }
}

// The university account as a settings field. Never blocks: an unconnected account costs only the
// downloads page, which gates itself. See docs/SETTINGS.md.
export default function MoodleAccountField({ site, switching }: Props) {
  const host = site ? hostOf(site) : ''
  return (
    <div className="settings-field" id="moodle-account">
      {/* No `<label>`: the control is a chip and a button, with nothing to focus. */}
      <div className="settings-label">
        <span>
          <Trans>University account</Trans>
        </span>
      </div>
      {!site || switching ? (
        <p className="settings-hint">
          <Trans>You can connect the account once your university is saved.</Trans>
        </p>
      ) : (
        <>
          <p className="settings-hint">
            <Trans>
              Fast Study signs in to <bdi dir="ltr">{host}</bdi> with this account to find and fetch
              recordings. You can connect it later.
            </Trans>
          </p>
          <div className="moodle-account-control">
            <AccountStatus />
          </div>
        </>
      )}
    </div>
  )
}
