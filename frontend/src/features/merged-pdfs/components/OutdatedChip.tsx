import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { MergedPart } from '@/types'
import { runStep } from '@/services/backend'
import { toastInitResult } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import Tooltip from '@/shared/components/Tooltip'
import { isRenderingPdf } from '../utils/mergedSelection'
import '@/styles/chip.css'
import '@/styles/spinner.css'
import './OutdatedChip.css'

// The picker's "Outdated PDF" chip: pressed, it offers to recreate that part's summary.pdf from the latest summary, then shows the render until the new PDF lands.
export default function OutdatedChip({ course, part }: { course: string; part: MergedPart }) {
  const { t } = useLingui()
  const { getInFlight, markStarted } = useRunnerStatus()
  const [asking, setAsking] = useState(false)
  const name = part.name
  const rendering = isRenderingPdf(getInFlight(course, part.name, part.kind))

  async function recreate() {
    setAsking(false)
    try {
      const result = await runStep(course, part.name, 'pdf', part.kind)
      toastInitResult(result, { busy: t`Step already running` })
      if (result.status === 'started') markStarted(course, part.name, part.kind)
    } catch (e) {
      toastFailure(e)
    }
  }

  if (rendering) {
    return (
      <span className="chip chip--warn merged-pick-outdated" role="status">
        <span className="spinner spinner--sm merged-pick-spinner" aria-hidden="true" />
        <Trans>Rendering…</Trans>
      </span>
    )
  }
  return (
    <>
      <Tooltip content={t`The PDF is older than the latest summary text. Click to recreate it.`}>
        <button
          type="button"
          className="chip chip--warn merged-pick-outdated"
          onClick={(e) => {
            e.preventDefault()
            setAsking(true)
          }}
        >
          <Trans>Outdated PDF</Trans>
        </button>
      </Tooltip>
      {asking && (
        <ConfirmModal
          message={t`Recreate the PDF of "${name}" from its latest summary?`}
          confirmLabel={t`Recreate`}
          cancelLabel={t`Cancel`}
          onCancel={() => setAsking(false)}
          onConfirm={() => void recreate()}
        />
      )}
    </>
  )
}
