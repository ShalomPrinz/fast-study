import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import LecturesTreePane from '@/features/lectures/sidebar/LecturesTreePane'
import { useKindParam } from '@/shared/hooks/useKindParam'
import { lectureToRemember, writeLastLecture } from '@/features/lectures/utils/lastLecture'
import './LecturesLayout.css'

// The pathless route wrapping the pages that show the lectures tree beside them.
export default function LecturesLayout() {
  const { pathname } = useLocation()
  const kind = useKindParam()

  // Remember each lecture opened here, so the Lectures nav row can reopen it from another page.
  useEffect(() => {
    const sel = lectureToRemember(pathname, kind)
    if (sel) writeLastLecture(sel)
  }, [pathname, kind])

  return (
    <div className="lectures-layout">
      <LecturesTreePane />
      <Outlet />
    </div>
  )
}
