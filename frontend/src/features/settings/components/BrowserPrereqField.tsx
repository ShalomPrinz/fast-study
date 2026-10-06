import { Trans, useLingui } from '@lingui/react/macro'
import { openExternalUrl } from '@/services/open'
import Icon from '@/shared/components/Icon'
import type { BrowserPrereqState } from '../hooks/useBrowserPrereq'
import '@/styles/button.css'
import '@/styles/settings-form.css'
import './BrowserPrereqField.css'

// Chrome's own download page. Edge deliberately has no counterpart: it ships with Windows, so the
// only machine that reaches this link is one where neither is installed, and Chrome is the fix.
const CHROME_DOWNLOAD_URL = 'https://www.google.com/chrome/'

const TONE: Record<BrowserPrereqState['kind'], string> = {
  checking: '',
  available: 'settings-status--ok',
  missing: 'settings-status--warn',
  unknown: 'settings-status--warn',
}

interface Props {
  state: BrowserPrereqState
  onRecheck: () => void
}

// A browser is a prerequisite of the download surface alone, so this field reads as a sibling of the
// two API keys while never blocking: nothing here reaches `missingEntries`. See docs/SETTINGS.md.
export default function BrowserPrereqField({ state, onRecheck }: Props) {
  const { t } = useLingui()

  const message = () => {
    switch (state.kind) {
      case 'checking':
        return t`Checking…`
      case 'available':
        return t`${state.browser} is installed — downloading is ready to use.`
      case 'missing':
        return t`No Chrome or Edge found on this computer.`
      case 'unknown':
        return t`We couldn't check right now.`
    }
  }

  return (
    <div
      className={`settings-field browser-prereq--${state.kind}`}
      id="browser-prereq"
      data-testid="browser-prereq"
      data-status={state.kind}
      data-channel={state.kind === 'available' ? (state.channel ?? undefined) : undefined}
    >
      {/* No `<label>`: there is nothing to focus here, only a status and a way to re-run it. */}
      <div className="settings-label">
        <span>
          <Trans>Browser for downloading recordings</Trans>
        </span>
        {state.kind === 'missing' && (
          <a
            className="settings-link browser-prereq-link"
            data-testid="browser-prereq-install-link"
            href={CHROME_DOWNLOAD_URL}
            onClick={(e) => {
              e.preventDefault()
              void openExternalUrl(CHROME_DOWNLOAD_URL)
            }}
          >
            <Trans>Install Chrome</Trans>
            <Icon icon="external-link" />
          </a>
        )}
      </div>
      <p className="settings-hint">
        <Trans>
          FastStudy uses Google Chrome or Microsoft Edge to fetch recordings from your course site.
          Turning a video into a summary doesn't need it.
        </Trans>
      </p>
      <p className={`settings-status ${TONE[state.kind]}`} id="browser-prereq-status">
        {message()}
      </p>
      {state.kind === 'missing' && (
        <>
          <p className="settings-note settings-note--warn">
            <Trans>
              Without one, FastStudy can't fetch recordings from your course site and can't capture
              a Zoom recording. Everything else works as usual — add a video yourself and it still
              becomes a summary. Install Chrome with the link above, then check again.
            </Trans>
          </p>
          {/* The service's own line, naming every browser it looked for and where. English, like
              every other message the services return. */}
          <p className="settings-hint browser-prereq-detail" dir="ltr">
            {state.detail}
          </p>
        </>
      )}
      {(state.kind === 'missing' || state.kind === 'unknown') && (
        <button className="btn btn--ghost browser-prereq-recheck" onClick={onRecheck}>
          <Trans>Check again</Trans>
        </button>
      )}
    </div>
  )
}
