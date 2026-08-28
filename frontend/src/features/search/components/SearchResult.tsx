import { Trans, useLingui } from '@lingui/react/macro'
import Icon from '@/shared/components/Icon'
import { fileUrl } from '@/services/database'
import type { CourseSummary } from '@/types'
import type { Hit } from '../utils/search'
import SearchSnippet from './SearchSnippet'
import '@/styles/chip.css'
import './SearchResult.css'

interface Props {
  summary: CourseSummary
  hits: Hit[]
  course: string
  hasPdf: boolean
}

// One lecture's card: a single header row — the whole row is the open-PDF button, disabled when the
// lecture has no summary.pdf — above every snippet found in that lecture.
export default function SearchResult({ summary, hits, course, hasPdf }: Props) {
  const { t } = useLingui()
  const { name, kind } = summary
  const openPdf = () => window.open(fileUrl(course, name, 'summary.pdf', kind), '_blank')
  const title = hasPdf ? t`Open PDF in new tab` : t`No PDF for this lecture`

  return (
    <div className="search-result">
      <button className="search-result-head" onClick={openPdf} disabled={!hasPdf} title={title}>
        <span className="search-result-icon">
          <Icon icon="file" />
        </span>
        <span className="search-result-title" dir="auto">
          {name}
        </span>
        <span className="chip chip--neutral">
          {kind === 'recitation' ? t`recitation` : t`lecture`}
        </span>
        <span className="search-result-open">
          {hasPdf ? (
            <Icon icon="external-link" />
          ) : (
            <span className="search-result-nopdf">
              <Trans>no PDF</Trans>
            </span>
          )}
        </span>
      </button>
      <div className="search-result-snippets">
        {hits.map((hit, i) => (
          <SearchSnippet key={i} hit={hit} />
        ))}
      </div>
    </div>
  )
}
