import { useState } from 'react'
import type { OverviewExtractor, CoursePhase } from '@/types'
import { overviewFileUrl } from '@/services/database'
import { toastInitResult } from '@/services/toaster'
import { generatedFiles, stepsFor, branchStatus } from '@/constants/overview'
import Icon from '@/components/Icon'
import ConfirmModal from '@/components/ConfirmModal'
import { useCourseOverview } from '@/routes/course/CourseOverviewContext'
import { ExtractorContext } from '@/routes/course/ExtractorContext'
import type { ExtractorValue } from '@/routes/course/ExtractorContext'
import ExtractorHeader from '@/routes/course/ExtractorHeader'

export default function ExtractorRow({ extractor }: { extractor: OverviewExtractor }) {
  const { course, files, status, generate } = useCourseOverview()
  const { slug, phases } = extractor
  const [expanded, setExpanded] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [regenerateStep, setRegenerateStep] = useState<{ phase: CoursePhase; label: string; rebuilds: string[] } | null>(null)

  const bs = branchStatus(status, files, slug, phases)
  const steps = stepsFor(phases)

  // Fire the mutation via the context, then toast its result here — a component may toast.
  async function handleGenerate(names?: string[], fromPhase?: CoursePhase) {
    const result = await generate(names, fromPhase)
    toastInitResult(result, {
      busy: 'Overview is already running for this course',
      error: 'Overview failed to start',
    })
  }

  function regenerate() {
    setRegenerateOpen(false)
    handleGenerate([slug])
  }

  function regenerateFromStep() {
    if (!regenerateStep) return
    const { phase } = regenerateStep
    setRegenerateStep(null)
    handleGenerate([slug], phase)
  }

  const value: ExtractorValue = {
    extractor,
    expanded,
    toggleExpanded: () => setExpanded((v) => !v),
    confirmRegenerate: () => setRegenerateOpen(true),
  }

  return (
    <ExtractorContext.Provider value={value}>
      <div className={`file-row course-branch${bs.done ? ' file-row--present' : ''}`}>
        <ExtractorHeader />

        {expanded && (
          <div className="course-steps">
            {steps.map((step, idx) => {
              const fileName = `${slug}${step.suffix}`
              const exists = files.some((f) => f.name === fileName)
              const st = status?.extractors[slug]
              const stepRunning = st?.status === 'running' && st?.phase === step.phase
              const isPdf = step.phase === 'to_pdf'
              const rebuilds = steps.slice(idx).map((s) => `${slug}${s.suffix}`)
              return (
                <div
                  key={step.phase}
                  className={`file-row${exists ? ' file-row--present' : ''}${stepRunning ? ' file-row--running' : ''}`}
                >
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
                            onClick={() => setRegenerateStep({ phase: step.phase, label: step.label, rebuilds })}
                            disabled={bs.running}
                          >↺</button>
                        )}
                      </span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {regenerateOpen && (
        <ConfirmModal
          message="The following files will be re-generated:"
          detail={
            <ul className="modal-file-list">
              {generatedFiles(slug, phases).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={regenerate}
          onCancel={() => setRegenerateOpen(false)}
        />
      )}

      {regenerateStep && (
        <ConfirmModal
          message={`Generating from ${regenerateStep.label} step will rebuild:`}
          postMessage="Are you sure you want to re-generate?"
          detail={
            <ul className="modal-file-list">
              {regenerateStep.rebuilds.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={regenerateFromStep}
          onCancel={() => setRegenerateStep(null)}
        />
      )}
    </ExtractorContext.Provider>
  )
}
