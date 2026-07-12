import { useState } from 'react'
import type { OverviewExtractor, CoursePhase } from '@/types'
import { overviewFileUrl } from '@/services/database'
import { formatMonthDate, formatFullTimestamp } from '@/utils/format'
import { formatRange } from '@/utils/overview'
import { toastInitResult } from '@/services/toaster'
import { lastGeneratedFile, generatedFiles, stepsFor, branchStatus } from '@/constants/overview'
import type { BranchStatus } from '@/constants/overview'
import Icon from '@/components/Icon'
import ConfirmModal from '@/components/ConfirmModal'
import { useCourseOverview } from '@/routes/course/CourseOverviewContext'
import { ExtractorContext } from '@/routes/course/ExtractorContext'
import type { ExtractorValue } from '@/routes/course/ExtractorContext'

// Pure status glyph for one extractor's final PDF. (B4 relocates to its own file.)
function BranchIndicator({ status }: { status: BranchStatus }) {
  if (status.running) return <span className="spinner spinner--sm" />
  if (status.error) return <span className="course-stage-error" title={status.error}>⚠</span>
  if (status.done) return <span className="file-check">✓</span>
  return <span className="course-stage-dot" />
}

export default function ExtractorRow({ extractor }: { extractor: OverviewExtractor }) {
  const { course, files, meta, status, generate } = useCourseOverview()
  const { slug, title, phases } = extractor
  const [expanded, setExpanded] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [regenerateStep, setRegenerateStep] = useState<{ phase: CoursePhase; label: string; rebuilds: string[] } | null>(null)

  const bs = branchStatus(status, files, slug, phases)
  const steps = stepsFor(phases)
  const entry = meta[slug]

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
        <div className="course-branch-header">
          <button
            className="course-branch-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className="course-branch-caret">{expanded ? '▾' : '▸'}</span>
            <span className="course-branch-heading">
              <span className="course-branch-name">{title}</span>
              {entry && (
                <span className="course-branch-subtitle">
                  {formatRange(entry)} ·{' '}
                  <span title={formatFullTimestamp(entry.generatedAt)}>{formatMonthDate(entry.generatedAt)}</span>
                </span>
              )}
            </span>
          </button>
          <span className="course-branch-actions">
            <BranchIndicator status={bs} />
            {bs.done && (
              <button
                className="file-open-btn"
                title="Open PDF in new tab"
                onClick={() => window.open(overviewFileUrl(course, lastGeneratedFile(slug, phases)), '_blank')}
              >
                <Icon icon="external-link" />
              </button>
            )}
            {bs.done ? (
              <button
                className="file-rotate-btn"
                title={`Re-generate ${title}`}
                onClick={() => setRegenerateOpen(true)}
                disabled={bs.running}
              >↺</button>
            ) : (
              <button
                className="file-action-btn"
                onClick={() => handleGenerate([slug])}
                disabled={bs.running}
              >
                Generate
              </button>
            )}
          </span>
        </div>

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
