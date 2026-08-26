import { Trans, useLingui } from '@lingui/react/macro'
import { overviewFileUrl } from '@/services/database'
import { formatMonthDate, formatFullTimestamp } from '@/shared/utils/format'
import { formatRange } from '@/features/course-overview/utils/overview'
import { toastInitResult } from '@/services/toaster'
import { lastGeneratedFile, branchStatus } from '@/features/course-overview/constants/overview'
import Icon from '@/shared/components/Icon'
import PdfWarningBadge from '@/shared/components/PdfWarningBadge'
import BranchIndicator from './BranchIndicator'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { useExtractor } from '@/features/course-overview/contexts/ExtractorContext'
import '@/styles/file-row.css'
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

  // The context never toasts; components do.
  async function handleGenerate() {
    const result = await generate([slug])
    toastInitResult(result, {
      busy: t`Overview is already running for this course`,
      error: t`Overview failed to start`,
    })
  }

  return (
    <div className="course-branch-header">
      <button className="course-branch-toggle" onClick={toggleExpanded} aria-expanded={expanded}>
        <span className="course-branch-caret">
          <Chevron open={expanded} />
        </span>
        <span className="course-branch-heading">
          <span className="course-branch-name">{title}</span>
          {entry && (
            <span className="course-branch-subtitle">
              {formatRange(entry)} ·{' '}
              <span title={formatFullTimestamp(entry.generatedAt)}>
                {formatMonthDate(entry.generatedAt)}
              </span>
            </span>
          )}
        </span>
      </button>
      <span className="course-branch-actions">
        <BranchIndicator status={bs} />
        <PdfWarningBadge badge={bs.warning ? { kind: 'warning', title: bs.warning } : null} />
        {bs.done && (
          <button
            className="file-open-btn"
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
            className="file-rotate-btn"
            title={t`Re-generate ${title}`}
            onClick={confirmRegenerate}
            disabled={bs.running}
          >
            ↺
          </button>
        ) : (
          <button className="btn btn--ghost" onClick={handleGenerate} disabled={bs.running}>
            <Trans>Generate</Trans>
          </button>
        )}
      </span>
    </div>
  )
}
