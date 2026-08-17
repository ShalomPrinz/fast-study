import Icon from '@/shared/components/Icon'
import { fileUrl } from '@/services/database'
import type { CourseSummary } from '@/types'
import type { Hit } from '../utils/search'
import SearchSnippet from './SearchSnippet'
import './SearchResult.css'

interface Props {
  summary: CourseSummary
  hits: Hit[]
  course: string
  hasPdf: boolean
}

// One lecture's block: a single header row — the whole row is the open-PDF button, disabled when the
// lecture has no summary.pdf — above every snippet found in that lecture.
export default function SearchResult({ summary, hits, course, hasPdf }: Props) {
  const { name, kind } = summary
  const openPdf = () => window.open(fileUrl(course, name, 'summary.pdf', kind), '_blank')
  const title = hasPdf ? 'Open PDF in new tab' : 'No PDF for this lecture'

  return (
    <div className="search-result">
      <button className="search-result-head" onClick={openPdf} disabled={!hasPdf} title={title}>
        <span className="search-result-title">{name}</span>
        <span className="search-result-kind">{kind}</span>
        <Icon icon="external-link" />
      </button>
      {hits.map((hit, i) => (
        <SearchSnippet key={i} hit={hit} />
      ))}
    </div>
  )
}
