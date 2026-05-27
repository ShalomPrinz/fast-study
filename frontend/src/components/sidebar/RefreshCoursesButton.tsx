import { useState } from 'react'
import Icon from '@/components/Icon'
import { useCourseTreeContext } from '@/contexts/CourseTreeContext'

export default function RefreshCoursesButton() {
  const { refreshCourses } = useCourseTreeContext()
  const [refreshing, setRefreshing] = useState(false)

  async function handleClick() {
    if (refreshing) return
    setRefreshing(true)
    try { await refreshCourses() } finally { setRefreshing(false) }
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
