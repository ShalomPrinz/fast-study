import { Trans, useLingui } from '@lingui/react/macro'
import Tooltip from '@/shared/components/Tooltip'
import type { BulkRun } from '@/features/downloads/hooks/useBulkRun'
import type { bulkGate } from '@/features/downloads/utils/runStatus'
import { moodleBusyMessage } from '@/features/downloads/utils/downloadErrors'
import type { GroupScope } from '@/features/downloads/utils/sections'
import { GROUP_SELECTOR } from '@/features/downloads/utils/sections'
import '@/styles/button.css'
import './GroupHeader.css'

interface Props {
  // Names the stable selectors `${GROUP_SELECTOR[scope]}-progress` and `-run`.
  scope: GroupScope
  bulk: BulkRun
  // The leaves the run would queue; null while a playlist's are unknown.
  count: number | null
  gate: ReturnType<typeof bulkGate>
  onStart: () => void
}

// A group header's run facts and its "Download all" button. See docs/BULK.md.
export default function BulkRunControls({ scope, bulk, count, gate, onStart }: Props) {
  const { t } = useLingui()
  const { run, state } = bulk
  const { active } = state
  // Named `leaves` so the button's message matches the catalog's `Download all {leaves}`.
  const leaves = count
  const selector = GROUP_SELECTOR[scope]
  const progress = `group-header-fact ${selector}-progress`
  const reason =
    gate.reason === 'expand'
      ? scope === 'playlist'
        ? t`Expand this playlist first`
        : t`Expand every playlist in this section first`
      : gate.reason === 'other-run'
        ? t`Another Download all is downloading these recordings`
        : gate.reason === 'moodle'
          ? moodleBusyMessage()
          : undefined
  return (
    <>
      {state.queueing && run && (
        <span className={progress}>
          <Trans>
            Downloading {run.at}/{run.total}…
          </Trans>
        </span>
      )}
      {!state.queueing && active > 0 && (
        <span className={progress}>
          <Trans>Downloading {active} more…</Trans>
        </span>
      )}
      {state.summary !== null && <span className={progress}>{state.summary}</span>}
      <Tooltip content={reason}>
        <button
          className={`btn btn--ghost group-header-run ${selector}-run`}
          onClick={onStart}
          disabled={gate.disabled}
        >
          {state.busy
            ? t`Downloading…`
            : leaves === null
              ? t`Download all`
              : t`Download all ${leaves}`}
        </button>
      </Tooltip>
    </>
  )
}
