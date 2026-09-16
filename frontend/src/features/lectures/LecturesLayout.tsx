import { Outlet } from 'react-router-dom'
import LecturesTreePane from '@/features/lectures/sidebar/LecturesTreePane'
import './LecturesLayout.css'

// The pathless route wrapping the pages that show the lectures tree beside them.
export default function LecturesLayout() {
  return (
    <div className="lectures-layout">
      <LecturesTreePane />
      <Outlet />
    </div>
  )
}
