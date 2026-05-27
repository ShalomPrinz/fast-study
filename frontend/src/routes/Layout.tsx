import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import type { Kind } from '@/types'
import { RunnerStatusProvider } from '@/contexts/RunnerStatusContext'
import { CourseTreeProvider } from '@/contexts/CourseTreeContext'
import { useKindParam } from '@/hooks/useKindParam'
import { lectureRoute } from '@/utils/route'
import { ToastContainer, toast } from '@/services/toaster'
import Sidebar from '@/components/sidebar/Sidebar'

export default function Layout() {
  const navigate = useNavigate()
  const kind = useKindParam()
  const match = useMatch('/:course/:lecture/*')
  const selected = match?.params.course && match?.params.lecture
    ? { course: match.params.course, lecture: match.params.lecture, kind }
    : null

  function handleSelect(course: string, lecture: string, k: Kind) {
    navigate(lectureRoute(course, lecture, k))
  }

  return (
    <CourseTreeProvider>
      <RunnerStatusProvider sendUpdate={toast}>
        <div className="layout">
          <Sidebar selected={selected} onSelect={handleSelect} />
          <Outlet />
          <ToastContainer position="top-right" autoClose={3000} />
        </div>
      </RunnerStatusProvider>
    </CourseTreeProvider>
  )
}
