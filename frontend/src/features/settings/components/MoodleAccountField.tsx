import { Trans } from '@lingui/react/macro'
import AccountStatus from '@/features/downloads/components/AccountStatus'
import { accountView } from '../utils/moodleSites'
import '@/styles/settings-form.css'
import './MoodleAccountField.css'

interface Props {
  // The saved site; the account always belongs to it, never to an unsaved choice in the form.
  site: string | null
  // The site the form holds (`null` while not yet savable): another one means connecting now would
  // sign in to the site about to be replaced.
  choice: string | null
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
export default function MoodleAccountField({ site, choice }: Props) {
  const view = accountView(site, choice)
  const host = site ? hostOf(site) : ''
  return (
    <div className="settings-field" id="moodle-account">
      {/* No `<label>`: the control is a chip and a button, with nothing to focus. */}
      <div className="settings-label">
        <span>
          <Trans>University account</Trans>
        </span>
      </div>
      {view === 'choose' && (
        <p className="settings-hint" data-account-hint="choose">
          <Trans>Choose your university above to connect its account.</Trans>
        </p>
      )}
      {view === 'save' && (
        <p className="settings-hint" data-account-hint="save">
          <Trans>You can connect the account once your university is saved.</Trans>
        </p>
      )}
      {view === 'connect' && site && (
        <>
          <p className="settings-hint">
            <Trans>
              FastStudy signs in to <bdi dir="ltr">{host}</bdi> with this account to find and fetch
              recordings. You can connect it later.
            </Trans>
          </p>
          <div className="moodle-account-control">
            {/* Keyed on the site: a new site is a new account, so the chip asks again. */}
            <AccountStatus key={site} />
          </div>
        </>
      )}
    </div>
  )
}
