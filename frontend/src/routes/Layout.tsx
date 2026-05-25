import { Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import type { LectureContext, Kind } from '../types'
import { useCourseTree } from '../hooks/useCourseTree'
import { RunnerStatusProvider } from '../contexts/RunnerStatusContext'
import { lectureRoute } from '../utils/route'
import { ToastContainer, toast } from '../services/toaster'
import Sidebar from '../components/sidebar/Sidebar'

export default function Layout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const match = useMatch('/:course/:lecture/*')
  const kind: Kind = searchParams.get('kind') === 'recitation' ? 'recitation' : 'lecture'
  const selected = match?.params.course && match?.params.lecture
    ? { course: match.params.course, lecture: match.params.lecture, kind }
    : null

  const { courses, files, transcribePartial, refreshCourses, onCourseClick } = useCourseTree(selected)

  function handleSelect(course: string, lecture: string, k: Kind) {
    navigate(lectureRoute(course, lecture, k))
  }

  const context: LectureContext = { files, transcribePartial, refreshCourses, kind }

  return (
    <RunnerStatusProvider sendUpdate={toast}>
      <div className="layout">
        <Sidebar
          courses={courses}
          selected={selected}
          onSelect={handleSelect}
          onCourseClick={onCourseClick}
          onRefresh={refreshCourses}
        />
        <Outlet context={context} />
        <ToastContainer position="top-right" autoClose={3000} />
      </div>
    </RunnerStatusProvider>
  )
}
