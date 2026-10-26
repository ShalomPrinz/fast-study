import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'
import type { AssignmentDocInfo, AssignmentDocName, InFlightEntry, RunError } from '@/types'
import { runAssignmentStep } from '@/services/backend'
import { openAssignmentGenerated } from '@/services/open'
import { toastInitResult } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { formatDuration } from '@/shared/utils/format'
import { useTimingStats } from '@/shared/hooks/useTimingStats'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { docCardState } from '@/features/lectures/utils/assignmentDocs'
import ConfirmModal from '@/shared/components/ConfirmModal'
import Icon from '@/shared/components/Icon'
import PdfWarningBadge from '@/shared/components/PdfWarningBadge'
import ProgressBar from '@/shared/components/ProgressBar'
import ServiceError from '@/shared/components/ServiceError'
import Tooltip from '@/shared/components/Tooltip'
import { assignmentEditorRoute } from '@/shared/utils/url'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/modal.css'
import './AssignmentDocCard.css'

interface Props {
  course: string
  assignment: string
  doc: AssignmentDocName
  info: AssignmentDocInfo | null
  run: InFlightEntry | null
  error: RunError | null
  inputs: { files: number; summaries: number; bytes: number }
}

// One generated assignment doc (the intuition guide or the full solution): not generated, writing,
// or ready with its PDF actions. Generation and regenerate share one backend step. See docs/LECTURES.md.
export default function AssignmentDocCard({
  course,
  assignment,
  doc,
  info,
  run,
  error,
  inputs,
}: Props) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { refreshCourses } = useCourseTreeContext()
  const [confirming, setConfirming] = useState(false)
  const state = docCardState(doc, info, run, error)
  const { phase, busy, pdfMissing, rendering } = state
  const hasInputs = inputs.files + inputs.summaries > 0

  const title = doc === 'intuition' ? t`Intuition Guide` : t`Full Solution`
  const subtitle =
    doc === 'intuition'
      ? t`Hints and a direction of thought for each question, without solving it`
      : t`A complete, step-by-step solution to every question`
  // The catalog row names the placeholder `doc`, which this component's prop would shadow.
  const regenTitle = ((doc: string) => t`Regenerate ${doc}?`)(title)
  const generateLabel = doc === 'intuition' ? t`Create guide` : t`Create solution`

  // The ETA of a running render uses the pdf bucket; an idle card's is its doc's own, over the inputs.
  const operation =
    phase === 'none'
      ? (`assignment_${doc}` as const)
      : rendering
        ? 'pdf'
        : phase === 'generating'
          ? (`assignment_${doc}` as const)
          : null
  const stats = useTimingStats(operation, rendering ? 0 : inputs.bytes)
  const startedAt = run ? Date.parse(run.startedAt) : NaN

  async function start(
    step: 'intuition' | 'solution' | 'intuition_pdf' | 'solution_pdf',
    fresh?: boolean,
  ) {
    // A refused start refreshes too: it was refused over state the tree may be showing stale.
    try {
      toastInitResult(await runAssignmentStep(course, assignment, step, fresh), {
        busy: t`Step already running`,
      })
    } catch (e) {
      toastFailure(e)
    }
    refreshCourses()
  }

  function confirmRegenerate() {
    setConfirming(false)
    void start(doc, true)
  }

  return (
    <section className="doc-card" data-state={phase} data-doc={doc}>
      <div className="doc-card-text">
        <div className="doc-card-top">
          <h2 className="doc-card-title">{title}</h2>
          {phase === 'ready' && info && (
            <span className="chip chip--ok doc-card-ready">
              <Trans>Ready</Trans>
            </span>
          )}
        </div>
        <p className="doc-card-subtitle">{phase === 'none' ? t`Not generated yet` : subtitle}</p>
      </div>
      {(phase === 'generating' || rendering) && (
        <div className="doc-card-progress">
          {!rendering && (
            <p className="doc-card-writing">
              <Trans>Gemini is writing…</Trans>
            </p>
          )}
          <ProgressBar
            stats={stats}
            startedAt={Number.isFinite(startedAt) ? startedAt : Date.now()}
          />
        </div>
      )}
      {pdfMissing && (
        <p className="doc-card-note">
          <Trans>The PDF is missing.</Trans>
        </p>
      )}
      <div className="doc-card-actions">
        {phase !== 'ready' && (
          <>
            <Tooltip
              content={
                !hasInputs && phase === 'none'
                  ? t`Switch on a file or choose course material first`
                  : undefined
              }
            >
              <button
                className="btn btn--primary"
                disabled={busy || !hasInputs}
                onClick={() => void start(doc)}
              >
                {generateLabel}
              </button>
            </Tooltip>
            {phase === 'none' && stats && !('message' in stats) && stats.estimated >= 1 && (
              <span className="doc-card-eta">~{formatDuration(stats.estimated)}</span>
            )}
          </>
        )}
        {phase === 'ready' && info && (
          <>
            {pdfMissing ? (
              <button
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void start(`${doc}_pdf`)}
              >
                <Trans>Create PDF</Trans>
              </button>
            ) : (
              <button
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void openAssignmentGenerated(course, assignment, `${doc}.pdf`)}
              >
                <Trans>Open PDF</Trans>
              </button>
            )}
            <button
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => navigate(assignmentEditorRoute(course, assignment, doc))}
            >
              <Trans>Edit</Trans>
            </button>
            <Tooltip content={t`Regenerate`}>
              <button
                className="btn btn--ghost doc-card-regen"
                aria-label={t`Regenerate`}
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                <Icon icon="rotate" />
              </button>
            </Tooltip>
            {info.pdf_warning && (
              <PdfWarningBadge badge={{ kind: 'warning', title: info.pdf_warning }} />
            )}
          </>
        )}
      </div>
      {state.error && (
        <div className="doc-card-error" role="alert">
          <ServiceError failure={state.error} />
        </div>
      )}
      {confirming && (
        <ConfirmModal
          message={regenTitle}
          postMessage={t`Gemini will write it again.`}
          confirmLabel={t`Regenerate`}
          cancelLabel={t`Cancel`}
          onConfirm={confirmRegenerate}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  )
}
