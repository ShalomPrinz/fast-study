import { useState, type ReactNode } from 'react'
import './PaginatedList.css'

interface Props<T> {
  items: T[]
  renderItem: (item: T) => ReactNode
  initialCount?: number
  firstChunk?: number
}

// Shows the latest `initialCount` items with a "Load more" row above that reveals older ones
// in doubling chunks. Owns its paging state; the parent only hands it data + renderItem.
export default function PaginatedList<T>({
  items,
  renderItem,
  initialCount = 2,
  firstChunk = 4,
}: Props<T>) {
  const [visible, setVisible] = useState(initialCount)
  const [chunk, setChunk] = useState(firstChunk)

  const hidden = items.length - visible
  const nextLoad = Math.min(chunk, hidden)
  // Slice from the tail so newly added items stay visible.
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
