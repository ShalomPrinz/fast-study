import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import type { CoursePhase } from '@/types'
import { overviewFileUrl } from '@/services/database'
import { formatMonthDate, formatFullTimestamp } from '@/utils/format'
import { formatRange } from '@/utils/overview'
import { useReportOnce } from '@/hooks/useReportOnce'
import { useToggleSet } from '@/hooks/useToggleSet'
import { toast, toastInitResult } from '@/services/toaster'
import { lastGeneratedFile, generatedFiles, stepsFor, branchStatus } from '@/constants/overview'
import type { BranchStatus } from '@/constants/overview'
import Icon from '@/components/Icon'
import ConfirmModal from '@/components/ConfirmModal'
import { CourseOverviewProvider, useCourseOverview } from '@/routes/course/CourseOverviewContext'
import GenerateAllButton from '@/routes/course/GenerateAllButton'

function BranchIndicator({ status }: { status: BranchStatus }) {
  if (status.running) return <span className="spinner spinner--sm" />
  if (status.error) return <span className="course-stage-error" title={status.error}>⚠</span>
  if (status.done) return <span className="file-check">✓</span>
  return <span className="course-stage-dot" />
}

function CourseOverviewBody() {
  const { course, extractors, files, meta, status, generate } = useCourseOverview()
  const [regenerateTarget, setRegenerateTarget] = useState<{ slug: string; title: string; phases: CoursePhase[] } | null>(null)
  const [regenerateStep, setRegenerateStep] = useState<{ slug: string; title: string; phase: CoursePhase; label: string; rebuilds: string[] } | null>(null)
  const expanded = useToggleSet(extractors?.map((e) => e.slug) ?? [])
  const { report: reportError, prune: pruneErrors } = useReportOnce((msg) => toast('error', msg))

  // Toast each extractor error once per (course, slug, message). Status is keyed by
  // slug; show the friendlier title when we have the extractor list loaded.
  useEffect(() => {
    if (!status) return
    const titleBySlug = new Map(extractors?.map((e) => [e.slug, e.title]))
    const valid = new Set<string>()
    for (const [slug, st] of Object.entries(status.extractors)) {
      if (st.status !== 'error') continue
      const key = `${course}/${slug}`
      valid.add(key)
      reportError(key, `${titleBySlug.get(slug) ?? slug}: ${st.message ?? 'failed'}`)
    }
    // Prune only this course's keys; other courses' remembered errors must survive a
    // switch away, or returning to them would re-toast an error already shown.
    pruneErrors(valid, (k) => k.startsWith(`${course}/`))
  }, [status, course, extractors])

  // Fire the mutation via the context, then toast its result here — a component may toast.
  async function handleGenerate(names?: string[], fromPhase?: CoursePhase, skipExisting?: boolean) {
    const result = await generate(names, fromPhase, skipExisting)
    toastInitResult(result, {
      busy: 'Overview is already running for this course',
      error: 'Overview failed to start',
    })
  }

  function confirmRegenerate() {
    if (!regenerateTarget) return
    const { slug } = regenerateTarget
    setRegenerateTarget(null)
    handleGenerate([slug])
  }

  function confirmRegenerateStep() {
    if (!regenerateStep) return
    const { slug, phase } = regenerateStep
    setRegenerateStep(null)
    handleGenerate([slug], phase)
  }

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">{course}</h2>

        <GenerateAllButton />

        {extractors === null ? (
          <div className="spinner" />
        ) : (
          <div className="file-list">
            {extractors.map(({ slug, title, phases }) => {
              const bs = branchStatus(status, files, slug, phases)
              const steps = stepsFor(phases)
              const entry = meta[slug]
              return (
                <div
                  key={slug}
                  className={`file-row course-branch${bs.done ? ' file-row--present' : ''}`}
                >
                  <div className="course-branch-header">
                    <button
                      className="course-branch-toggle"
                      onClick={() => expanded.toggle(slug)}
                      aria-expanded={expanded.has(slug)}
                    >
                      <span className="course-branch-caret">{expanded.has(slug) ? '▾' : '▸'}</span>
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
                          onClick={() => setRegenerateTarget({ slug, title, phases })}
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

                  {expanded.has(slug) && (
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
                                      onClick={() => setRegenerateStep({ slug, title, phase: step.phase, label: step.label, rebuilds })}
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
              )
            })}
          </div>
        )}
      </div>

      {regenerateTarget && (
        <ConfirmModal
          message="The following files will be re-generated:"
          detail={
            <ul className="modal-file-list">
              {generatedFiles(regenerateTarget.slug, regenerateTarget.phases).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={confirmRegenerate}
          onCancel={() => setRegenerateTarget(null)}
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
          onConfirm={confirmRegenerateStep}
          onCancel={() => setRegenerateStep(null)}
        />
      )}
    </main>
  )
}

export default function CourseView() {
  const { course = '' } = useParams()
  if (!course) return null
  return (
    <CourseOverviewProvider course={course}>
      <CourseOverviewBody />
    </CourseOverviewProvider>
  )
}
