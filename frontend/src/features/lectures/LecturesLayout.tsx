import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import LecturesTreePane from '@/features/lectures/sidebar/LecturesTreePane'
import { useSelection } from '@/features/lectures/hooks/useSelection'
import { writeLastLecture } from '@/features/lectures/utils/lastLecture'
import './LecturesLayout.css'

// The pathless route wrapping the pages that show the lectures tree beside them.
export default function LecturesLayout() {
  const { selected } = useSelection()
  const { course, lecture, kind } = selected ?? {}

  // Remember each lecture opened here, so the Lectures nav row can reopen it from another page.
  useEffect(() => {
    if (course && lecture && kind) writeLastLecture({ course, lecture, kind })
  }, [course, lecture, kind])

  return (
    <div className="lectures-layout">
      <LecturesTreePane />
      <Outlet />
    </div>
  )
}
