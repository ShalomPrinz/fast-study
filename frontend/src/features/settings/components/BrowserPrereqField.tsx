import { useCallback, useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { fetchBrowserPrereq } from '@/services/settings'
import Icon from '@/shared/components/Icon'
import '@/styles/button.css'
import '@/styles/settings-form.css'
import './BrowserPrereqField.css'

// Chrome's own download page. Edge deliberately has no counterpart: it ships with Windows, so the
// only machine that reaches this link is one where neither is installed, and Chrome is the fix.
const CHROME_DOWNLOAD_URL = 'https://www.google.com/chrome/'

type State =
  | { kind: 'checking' }
  | { kind: 'available'; browser: string }
  | { kind: 'missing'; detail: string }
  // The service was unreachable, which is an unknown answer and never "no browser" — the same rule
  // the API key probe follows for an unreachable provider.
  | { kind: 'unknown' }

const TONE: Record<State['kind'], string> = {
  checking: '',
  available: 'settings-status--ok',
  missing: 'settings-status--warn',
  unknown: 'settings-status--warn',
}

// A browser is a prerequisite of the download surface alone, so this field reads as a sibling of the
// two API keys while never blocking: nothing here reaches `missingEntries`. See docs/SETTINGS.md.
export default function BrowserPrereqField() {
  const { t } = useLingui()
  const [state, setState] = useState<State>({ kind: 'checking' })

  const check = useCallback(async () => {
    setState({ kind: 'checking' })
    try {
      const prereq = await fetchBrowserPrereq()
      setState(
        prereq.available && prereq.browser
          ? { kind: 'available', browser: prereq.browser }
          : { kind: 'missing', detail: prereq.detail },
      )
    } catch {
      // A downed service is already toasted centrally by the http client; the field only stops
      // claiming anything about this machine.
      setState({ kind: 'unknown' })
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

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
    <div className={`settings-field browser-prereq--${state.kind}`} id="browser-prereq">
      {/* No `<label>`: there is nothing to focus here, only a status and a way to re-run it. */}
      <div className="settings-label">
        <span>
          <Trans>Browser for downloading recordings</Trans>
        </span>
        {state.kind === 'missing' && (
          <a
            className="settings-link browser-prereq-link"
            href={CHROME_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Trans>Install Chrome</Trans>
            <Icon icon="external-link" />
          </a>
        )}
      </div>
      <p className="settings-hint">
        <Trans>
          Fast Study drives Google Chrome or Microsoft Edge to fetch recordings from your course
          site. Turning a video into a summary never uses it.
        </Trans>
      </p>
      <p className={`settings-status ${TONE[state.kind]}`} id="browser-prereq-status">
        {message()}
      </p>
      {state.kind === 'missing' && (
        <>
          <p className="settings-note settings-note--warn">
            <Trans>
              Without one, Fast Study can't fetch recordings from your course site and can't capture
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
        <button className="btn btn--ghost browser-prereq-recheck" onClick={() => void check()}>
          <Trans>Check again</Trans>
        </button>
      )}
    </div>
  )
}
