import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { OverviewStep } from '@/features/course-overview/constants/overview'
import { overviewFileUrl } from '@/services/database'
import { toastInitResult } from '@/services/toaster'
import { stepsFor, branchStatus } from '@/features/course-overview/constants/overview'
import Icon from '@/shared/components/Icon'
import StatusNode from '@/shared/components/StatusNode'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { useExtractor } from '@/features/course-overview/contexts/ExtractorContext'
import '@/styles/file-row.css'
import '@/styles/modal.css'

export default function StepRow({ step }: { step: OverviewStep }) {
  const { t } = useLingui()
  const { course, files, status, generate } = useCourseOverview()
  const { extractor } = useExtractor()
  const { slug, phases } = extractor
  const [regenerateOpen, setRegenerateOpen] = useState(false)

  const fileName = `${slug}${step.suffix}`
  const exists = files.some((f) => f.name === fileName)
  const st = status?.extractors[slug]
  const stepRunning = st?.status === 'running' && st?.phase === step.phase
  const isPdf = step.phase === 'to_pdf'
  const bs = branchStatus(status, files, slug, phases)
  const stepLabel = t(step.label)

  // Re-generating from this phase rebuilds it and every later one.
  const steps = stepsFor(phases)
  const idx = steps.findIndex((s) => s.phase === step.phase)
  const rebuilds = steps.slice(idx).map((s) => `${slug}${s.suffix}`)

  async function regenerateFromStep() {
    setRegenerateOpen(false)
    const result = await generate([slug], step.phase)
    toastInitResult(result, {
      busy: t`Overview is already running for this course`,
      error: t`Overview failed to start`,
    })
  }

  return (
    <>
      <div
        className={`file-row${exists ? ' file-row--present' : ''}${stepRunning ? ' file-row--running' : ''}`}
      >
        <div className="file-row-header">
          <span className="file-name">{fileName}</span>
          <span className="file-row-right">
            <span className="file-slot file-slot--status">
              {stepRunning ? (
                <StatusNode state="running" />
              ) : exists ? (
                <StatusNode state="done" />
              ) : (
                <StatusNode state="pending" />
              )}
            </span>
            <span className="file-slot file-slot--open">
              {isPdf && exists && (
                <button
                  className="file-open-btn"
                  title={t`Open PDF in new tab`}
                  onClick={() => window.open(overviewFileUrl(course, fileName), '_blank')}
                >
                  <Icon icon="external-link" />
                </button>
              )}
            </span>
            <span className="file-slot file-slot--rotate">
              {exists && (
                <button
                  className="file-rotate-btn"
                  title={t`Re-generate from ${stepLabel}`}
                  onClick={() => setRegenerateOpen(true)}
                  disabled={bs.running}
                >
                  ↺
                </button>
              )}
            </span>
          </span>
        </div>
      </div>

      {regenerateOpen && (
        <ConfirmModal
          message={t`Generating from ${stepLabel} step will rebuild:`}
          postMessage={t`Are you sure you want to re-generate?`}
          detail={
            <ul className="modal-file-list">
              {rebuilds.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={regenerateFromStep}
          onCancel={() => setRegenerateOpen(false)}
        />
      )}
    </>
  )
}
