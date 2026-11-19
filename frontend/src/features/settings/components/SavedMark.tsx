import { Trans } from '@lingui/react/macro'
import './SavedMark.css'

// The brief "Saved" beside a section title once one of its fields has landed.
export default function SavedMark({ show }: { show: boolean }) {
  return (
    <span className="saved-mark" role="status" data-saved={show ? 'true' : undefined}>
      {show && (
        <>
          <span aria-hidden>✓</span> <Trans>Saved</Trans>
        </>
      )}
    </span>
  )
}
