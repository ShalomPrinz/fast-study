import { useState, type ReactNode } from 'react'

interface Props<T> {
  items: T[]
  renderItem: (item: T) => ReactNode
  initialCount?: number
  firstChunk?: number
}

// Self-contained windowing for a sidebar list: shows the latest `initialCount` items
// (the array tail) with a "Load more" row pinned above that reveals older items in
// doubling chunks (4, then 8, then 16…). Owns its own paging state — the parent only
// hands it the data + a renderItem closure, so selection/rename/drag stay in Sidebar.
export default function PaginatedList<T>({ items, renderItem, initialCount = 2, firstChunk = 4 }: Props<T>) {
  const [visible, setVisible] = useState(initialCount)
  const [chunk, setChunk] = useState(firstChunk)

  const hidden = items.length - visible
  const nextLoad = Math.min(chunk, hidden)
  // Slice from the end so newly added items (appended at the tail) stay visible.
  const shown = hidden > 0 ? items.slice(hidden) : items

  function loadMore() {
    setVisible((v) => v + chunk)
    setChunk((c) => c * 2) // each chunk is double the previous
  }

  return (
    <>
      {hidden > 0 && (
        <li>
          <button className="load-more-btn" onClick={loadMore} type="button">
            Load {nextLoad} more
          </button>
        </li>
      )}
      {shown.map(renderItem)}
    </>
  )
}
