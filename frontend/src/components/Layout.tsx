import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import type { LectureContext } from '../types'
import { useCourseTree } from '../hooks/useCourseTree'
import Sidebar from './Sidebar'

export default function Layout() {
  const navigate = useNavigate()

  const match = useMatch('/:course/:lecture/*')
  const selected = match?.params.course && match?.params.lecture
    ? { course: match.params.course, lecture: match.params.lecture }
    : null

  const { courses, files, refreshCourses, onCourseClick } = useCourseTree(selected)

  function handleSelect(course: string, lecture: string) {
    navigate(`/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`)
  }

  const context: LectureContext = { files, refreshCourses }

  return (
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
  )
}
