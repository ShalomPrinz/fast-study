import { overviewFileUrl } from '@/services/database'
import { formatMonthDate, formatFullTimestamp } from '@/utils/format'
import { formatRange } from '@/utils/overview'
import { toastInitResult } from '@/services/toaster'
import { lastGeneratedFile, branchStatus } from '@/constants/overview'
import Icon from '@/components/Icon'
import BranchIndicator from '@/routes/course/BranchIndicator'
import { useCourseOverview } from '@/routes/course/CourseOverviewContext'
import { useExtractor } from '@/routes/course/ExtractorContext'

// Extractor row header: caret/title/subtitle toggle + status glyph + open-PDF and regenerate/Generate actions
export default function ExtractorHeader() {
  const { course, files, meta, status, generate } = useCourseOverview()
  const { extractor, expanded, toggleExpanded, confirmRegenerate } = useExtractor()
  const { slug, title, phases } = extractor
  const bs = branchStatus(status, files, slug, phases)
  const entry = meta[slug]

  // Fire the mutation via the context, then toast its result here — a component may toast.
  async function handleGenerate() {
    const result = await generate([slug])
    toastInitResult(result, {
      busy: 'Overview is already running for this course',
      error: 'Overview failed to start',
    })
  }

  return (
    <div className="course-branch-header">
      <button
        className="course-branch-toggle"
        onClick={toggleExpanded}
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
            onClick={confirmRegenerate}
            disabled={bs.running}
          >↺</button>
        ) : (
          <button
            className="file-action-btn"
            onClick={handleGenerate}
            disabled={bs.running}
          >
            Generate
          </button>
        )}
      </span>
    </div>
  )
}
