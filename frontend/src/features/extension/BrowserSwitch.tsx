import { Trans } from '@lingui/react/macro'
import { BROWSERS, type Browser } from './browsers'
import '@/styles/segmented.css'
import './BrowserSwitch.css'

const LABELS: Record<Browser, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge' }

interface Props {
  browser: Browser
  onSelect: (browser: Browser) => void
}

// The extension guide's browser choice, a labelled segmented row in the Downloads header.
export default function BrowserSwitch({ browser, onSelect }: Props) {
  return (
    <div className="browser-switch">
      <span className="browser-switch-label">
        <Trans>Choose your browser:</Trans>
      </span>
      <div className="mode-toggle mode-toggle--light" role="group">
        {BROWSERS.map((b) => (
          <button
            key={b}
            aria-pressed={browser === b}
            className={`mode-toggle-btn${browser === b ? ' active' : ''}`}
            onClick={() => onSelect(b)}
          >
            {LABELS[b]}
          </button>
        ))}
      </div>
    </div>
  )
}
