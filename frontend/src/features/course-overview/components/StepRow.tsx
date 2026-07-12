import { useState } from 'react'
import type { OverviewStep } from '@/features/course-overview/constants/overview'
import { overviewFileUrl } from '@/services/database'
import { toastInitResult } from '@/services/toaster'
import { stepsFor, branchStatus } from '@/features/course-overview/constants/overview'
import Icon from '@/shared/components/Icon'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { useExtractor } from '@/features/course-overview/contexts/ExtractorContext'

// phase of an extractor: status glyph and a ↺ that re-generates from this phase forward
export default function StepRow({ step }: { step: OverviewStep }) {
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

  // Re-generating from this phase rebuilds it and every later phase.
  const steps = stepsFor(phases)
  const idx = steps.findIndex((s) => s.phase === step.phase)
  const rebuilds = steps.slice(idx).map((s) => `${slug}${s.suffix}`)

  async function regenerateFromStep() {
    setRegenerateOpen(false)
    const result = await generate([slug], step.phase)
    toastInitResult(result, {
      busy: 'Overview is already running for this course',
      error: 'Overview failed to start',
    })
  }

  return (
    <>
      <div className={`file-row${exists ? ' file-row--present' : ''}${stepRunning ? ' file-row--running' : ''}`}>
        <div className="file-row-header">
          <span className="file-name">{fileName}</span>
          <span className="file-row-right">
            <span className="file-slot file-slot--status">
              {stepRunning ? (
                <div className="spinner spinner--sm" />
              ) : exists ? (
                <span className="file-check">✓</span>
              ) : (
                <span className="course-stage-dot" />
              )}
            </span>
            <span className="file-slot file-slot--open">
              {isPdf && exists && (
                <button
                  className="file-open-btn"
                  title="Open PDF in new tab"
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
                  title={`Re-generate from ${step.label}`}
                  onClick={() => setRegenerateOpen(true)}
                  disabled={bs.running}
                >↺</button>
              )}
            </span>
          </span>
        </div>
      </div>

      {regenerateOpen && (
        <ConfirmModal
          message={`Generating from ${step.label} step will rebuild:`}
          postMessage="Are you sure you want to re-generate?"
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
