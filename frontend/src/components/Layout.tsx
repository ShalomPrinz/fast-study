import { useState, useEffect, useMemo } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { fetchTree, fetchCourse, Course, Lecture, FileStatus } from '../api'
import Sidebar from './Sidebar'

export interface LayoutContext {
  courses: Course[]
  files: FileStatus | null
  refreshCourses: () => void
}

export default function Layout() {
  const [courses, setCourses] = useState<Course[]>([])
  const [sortedCourses, setSortedCourses] = useState<Course[]>([])
  const navigate = useNavigate()

  const match = useMatch('/:course/:lecture/*')
  const selected = match?.params.course && match?.params.lecture
    ? { course: match.params.course, lecture: match.params.lecture }
    : null

  useEffect(() => {
    fetchTree().then(setCourses)
  }, [])

  useEffect(() => {
    setSortedCourses(
      courses.map((c) => ({
        ...c,
        lectures: [...c.lectures].sort((a, b) => a.name.localeCompare(b.name)),
      }))
    )
  }, [courses])

  const files = useMemo<FileStatus | null>(() => {
    if (!selected) return null
    const course = courses.find((c) => c.name === selected.course)
    const lecture = course?.lectures.find((l: Lecture) => l.name === selected.lecture)
    return lecture?.files ?? null
  }, [courses, selected])

  function refreshCourses() {
    fetchTree().then(setCourses)
  }

  function handleCourseClick(courseName: string) {
    fetchCourse(courseName).then((updated) => {
      if (!updated) return
      setCourses((prev) => prev.map((c) => (c.name === courseName ? updated : c)))
    })
  }

  function handleSelect(course: string, lecture: string) {
    navigate(`/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`)
  }

  const context: LayoutContext = { courses, files, refreshCourses }

  return (
    <div className="layout">
      <Sidebar
        courses={sortedCourses}
        selected={selected}
        onSelect={handleSelect}
        onCourseClick={handleCourseClick}
      />
      <Outlet context={context} />
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  )
}
