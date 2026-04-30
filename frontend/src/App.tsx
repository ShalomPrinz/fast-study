import { useState, useEffect, useMemo } from 'react'
import { fetchTree, fetchCourse, runStep, Step, FileStatus, Lecture, Course } from './api'
import Sidebar from './components/Sidebar'
import MainView from './components/MainView'

export interface Selected {
  course: string
  lecture: string
}

export interface ReqState {
  step: Step
  status: 'inflight' | 'error'
  message?: string
}

export default function App() {
  const [courses, setCourses] = useState<Course[]>([])
  const [sortedCourses, setSortedCourses] = useState<Course[]>([])
  const [selected, setSelected] = useState<Selected | null>(null)
  const [reqState, setReqState] = useState<ReqState | null>(null)

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

  function handleCourseClick(courseName: string) {
    fetchCourse(courseName).then((updated) => {
      if (!updated) return
      setCourses((prev) => prev.map((c) => (c.name === courseName ? updated : c)))
    })
  }

  function handleSelect(course: string, lecture: string) {
    setSelected({ course, lecture })
    setReqState(null)
  }

  async function handleRun(step: Step) {
    if (!selected) return
    setReqState({ step, status: 'inflight' })
    const result = await runStep(selected.course, selected.lecture, step)
    if (result.status === 'done') {
      setReqState(null)
      fetchTree().then(setCourses)
    } else {
      setReqState({ step, status: 'error', message: result.message })
    }
  }

  return (
    <div className="layout">
      <Sidebar
        courses={sortedCourses}
        selected={selected}
        onSelect={handleSelect}
        onCourseClick={handleCourseClick}
      />
      <MainView
        selected={selected}
        files={files}
        reqState={reqState}
        onRun={handleRun}
        inflight={reqState?.status === 'inflight'}
      />
    </div>
  )
}
