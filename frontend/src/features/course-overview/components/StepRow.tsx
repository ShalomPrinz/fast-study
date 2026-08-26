import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { OverviewStep } from '@/features/course-overview/constants/overview'
import { toastInitResult } from '@/services/toaster'
import { stepsFor, branchStatus } from '@/features/course-overview/constants/overview'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { useExtractor } from '@/features/course-overview/contexts/ExtractorContext'
import './ExtractorSteps.css'
import '@/styles/modal.css'

// One phase of a branch's run. A phase whose file is on disk doubles as the re-generate control for
// itself and every phase after it — the only per-phase action, so it needs no separate button.
export default function StepRow({ step }: { step: OverviewStep }) {
  const { t } = useLingui()
  const { files, status, generate } = useCourseOverview()
  const { extractor } = useExtractor()
  const { slug, phases } = extractor
  const [regenerateOpen, setRegenerateOpen] = useState(false)

  const fileName = `${slug}${step.suffix}`
  const exists = files.some((f) => f.name === fileName)
  const st = status?.extractors[slug]
  const stepRunning = st?.status === 'running' && st?.phase === step.phase
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

  const modifier = exists ? ' overview-phase--done' : stepRunning ? ' overview-phase--running' : ''

  return (
    <>
      <button
        className={`overview-phase${modifier}`}
        title={exists ? t`Re-generate from ${stepLabel}` : undefined}
        onClick={() => setRegenerateOpen(true)}
        disabled={!exists || bs.running}
      >
        <span className={`overview-phase-node${exists ? ' overview-phase-node--done' : ''}`}>
          {exists && (
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2.5 6.2l2.4 2.4L9.5 4"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        {stepLabel}
      </button>

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
