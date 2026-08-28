import { Trans, useLingui } from '@lingui/react/macro'
import { overviewFileUrl } from '@/services/database'
import { formatMonthDate, formatFullTimestamp } from '@/shared/utils/format'
import { formatRange } from '@/features/course-overview/utils/overview'
import { toastInitResult } from '@/services/toaster'
import {
  lastGeneratedFile,
  branchStatus,
  stepsFor,
} from '@/features/course-overview/constants/overview'
import Icon from '@/shared/components/Icon'
import StatusNode from '@/shared/components/StatusNode'
import type { StatusNodeState } from '@/shared/components/StatusNode'
import PdfWarningBadge from '@/shared/components/PdfWarningBadge'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { useExtractor } from '@/features/course-overview/contexts/ExtractorContext'
import '@/styles/pipeline-card.css'
import '@/styles/button.css'
import './ExtractorHeader.css'
import Chevron from '@/shared/components/Chevron'

export default function ExtractorHeader() {
  const { t } = useLingui()
  const { course, files, meta, status, generate } = useCourseOverview()
  const { extractor, expanded, toggleExpanded, confirmRegenerate } = useExtractor()
  const { slug, title, phases } = extractor
  const bs = branchStatus(status, files, slug, phases)
  const entry = meta[slug]

  const state: StatusNodeState = bs.running
    ? 'running'
    : bs.error
      ? 'failed'
      : bs.done
        ? 'done'
        : 'pending'

  // A running branch replaces its actions with the phase it is on, the way a running pipeline row
  // replaces its action with an ETA — there is no per-branch time estimate to show instead.
  const st = status?.extractors[slug]
  const runningPhase = stepsFor(phases).find((s) => s.phase === st?.phase)
  const phaseLabel = runningPhase ? t(runningPhase.label) : null

  // The context never toasts; components do.
  async function handleGenerate() {
    const result = await generate([slug])
    toastInitResult(result, {
      busy: t`Overview is already running for this course`,
      error: t`Overview failed to start`,
    })
  }

  return (
    <div className="pipeline-row">
      <StatusNode state={state} title={bs.error ?? undefined} />
      <button className="overview-branch-toggle" onClick={toggleExpanded} aria-expanded={expanded}>
        <span className="overview-branch-caret">
          <Chevron open={expanded} />
        </span>
        <span className="overview-branch-heading">
          <span className="overview-branch-name">{title}</span>
          {entry && (
            <span className="overview-branch-subtitle">
              {formatRange(entry)} ·{' '}
              <span title={formatFullTimestamp(entry.generatedAt)}>
                {formatMonthDate(entry.generatedAt)}
              </span>
            </span>
          )}
        </span>
      </button>
      {bs.running ? (
        <span className="overview-branch-running">
          {phaseLabel ? t`${phaseLabel}…` : t`Generating…`}
        </span>
      ) : (
        <span className="overview-branch-actions">
          <PdfWarningBadge badge={bs.warning ? { kind: 'warning', title: bs.warning } : null} />
          {bs.done && (
            <button
              className="pipeline-icon-btn"
              title={t`Open PDF in new tab`}
              onClick={() =>
                window.open(overviewFileUrl(course, lastGeneratedFile(slug, phases)), '_blank')
              }
            >
              <Icon icon="external-link" />
            </button>
          )}
          {bs.done ? (
            <button
              className="pipeline-icon-btn"
              title={t`Re-generate ${title}`}
              onClick={confirmRegenerate}
            >
              <Icon icon="rotate" />
            </button>
          ) : (
            <button className="btn btn--ghost" onClick={handleGenerate}>
              <Trans>Generate</Trans>
            </button>
          )}
        </span>
      )}
    </div>
  )
}
