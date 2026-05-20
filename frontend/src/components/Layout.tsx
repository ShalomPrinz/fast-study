import { Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { ToastContainer, toast } from 'react-toastify'
import type { LectureContext, Kind } from '../types'
import { useCourseTree } from '../hooks/useCourseTree'
import { ResumeStatusProvider } from '../contexts/ResumeStatusContext'
import Sidebar from './Sidebar'

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
    const suffix = k === 'recitation' ? '?kind=recitation' : ''
    navigate(`/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}${suffix}`)
  }

  const context: LectureContext = { files, transcribePartial, refreshCourses, kind }

  return (
    <ResumeStatusProvider onError={(msg) => toast.error(msg)}>
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
    </ResumeStatusProvider>
  )
}
