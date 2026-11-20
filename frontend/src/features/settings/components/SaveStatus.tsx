import { Trans } from '@lingui/react/macro'
import './SaveStatus.css'

// The page-header save status: nothing until a save lands, then "✓ Saved". A repeat save keeps the
// chip mounted and only remounts the sheen (keyed on the tick), so it replays without a flicker.
export default function SaveStatus({ savedTick }: { savedTick: number }) {
  return (
    <span className="save-status" role="status" data-save-state={savedTick > 0 ? 'saved' : 'idle'}>
      {savedTick > 0 && (
        <span className="save-status-chip">
          <span aria-hidden>✓</span> <Trans>Saved</Trans>
          <span key={savedTick} className="save-status-sheen" aria-hidden />
        </span>
      )}
    </span>
  )
}
