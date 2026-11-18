import './TreeProgress.css'

// The tree's 4px done/total bar; `kind` picks the fill token. Empty when total is 0.
export default function TreeProgress({
  kind,
  done,
  total,
}: {
  kind: 'lecture' | 'recitation' | 'assignment'
  done: number
  total: number
}) {
  if (total <= 0) return null
  return (
    <span className="tree-progress" aria-hidden="true">
      <span
        className={`tree-progress-fill tree-progress-fill--${kind}`}
        style={{ inlineSize: `${(done / total) * 100}%` }}
      />
    </span>
  )
}
