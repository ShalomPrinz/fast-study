import { Trans } from '@lingui/react/macro'
import { saveState } from '../utils/saveStatus'
import './SaveStatus.css'

// The page-header save status: "Saving…" in flight, then "✓ Saved" with a brief sheen.
export default function SaveStatus({ saving, savedTick }: { saving: boolean; savedTick: number }) {
  const state = saveState(saving, savedTick)
  return (
    <span className="save-status" role="status" data-save-state={state}>
      {state === 'saving' && <Trans>Saving…</Trans>}
      {state === 'saved' && (
        <span key={savedTick} className="save-status-chip">
          <span aria-hidden>✓</span> <Trans>Saved</Trans>
        </span>
      )}
    </span>
  )
}
