import { Trans, useLingui } from '@lingui/react/macro'
import Tooltip from '@/shared/components/Tooltip'
import '@/styles/button.css'

// The header's "Run Remaining"; while a run is on the page it is disabled and its hint says why.
export default function RunRemainingButton({
  inflight,
  onClick,
}: {
  inflight: boolean
  onClick: () => void
}) {
  const { t } = useLingui()
  return (
    <Tooltip content={inflight ? t`A run is already in progress here.` : undefined}>
      <button className="btn btn--primary" onClick={onClick} disabled={inflight}>
        <Trans>Run Remaining</Trans>
      </button>
    </Tooltip>
  )
}
