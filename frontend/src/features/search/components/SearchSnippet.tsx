import type { Hit } from '../utils/search'

// One snippet with each occurrence highlighted by slicing at the hit's offsets — never raw HTML.
export default function SearchSnippet({ hit }: { hit: Hit }) {
  const { snippet, ranges } = hit

  return (
    <p className="search-result-snippet" dir="auto">
      {ranges.map((range, i) => (
        <span key={i}>
          {snippet.slice(i === 0 ? 0 : ranges[i - 1].end, range.start)}
          <mark className="search-mark">{snippet.slice(range.start, range.end)}</mark>
        </span>
      ))}
      {snippet.slice(ranges[ranges.length - 1].end)}
    </p>
  )
}
