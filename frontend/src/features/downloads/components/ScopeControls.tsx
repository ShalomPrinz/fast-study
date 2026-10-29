import type { ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Scope } from '@/features/downloads/utils/scope'
import '@/styles/segmented.css'
import './ScopeControls.css'

interface Props {
  scope: Scope
  onScope: (scope: Scope) => void
  // The content-type cards, shown only in All; their caption goes with them.
  cards?: ReactNode
}

// The panel's control row: the New | All switch, and in All the media cards, each under its caption.
export default function ScopeControls({ scope, onScope, cards }: Props) {
  const { t } = useLingui()
  const options: [Scope, string][] = [
    ['new', t`New`],
    ['all', t`All`],
  ]
  return (
    <div className="downloads-controls">
      <div className="downloads-control">
        <span className="downloads-control-caption">{t`What to show`}</span>
        <div className="mode-toggle mode-toggle--light downloads-scope-switch">
          {options.map(([value, label]) => (
            <button
              key={value}
              className={scope === value ? 'mode-toggle-btn active' : 'mode-toggle-btn'}
              aria-pressed={scope === value}
              onClick={() => onScope(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {cards && (
        <div className="downloads-control">
          <span className="downloads-control-caption">{t`Content type`}</span>
          {cards}
        </div>
      )}
    </div>
  )
}
