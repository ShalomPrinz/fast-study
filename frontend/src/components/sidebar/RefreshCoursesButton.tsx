import { useState } from 'react'
import Icon from '../Icon'

interface Props {
  onRefresh: () => void | Promise<void>
}

export default function RefreshCoursesButton({ onRefresh }: Props) {
  const [refreshing, setRefreshing] = useState(false)

  async function handleClick() {
    if (refreshing) return
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }

  return (
    <button
      className={`sidebar-refresh-btn${refreshing ? ' spinning' : ''}`}
      onClick={handleClick}
      disabled={refreshing}
      title="Refresh Courses Tree"
      aria-label="Refresh Courses Tree"
    >
      <Icon icon="refresh" />
    </button>
  )
}
