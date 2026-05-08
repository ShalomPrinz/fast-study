import { useState, useEffect, useMemo } from 'react'
import type { Course, Lecture, FileStatus } from '../types'
import { fetchTree, fetchCourse } from '../api'

export function useCourseTree(selected: { course: string; lecture: string } | null) {
  const [courses, setCourses] = useState<Course[]>([])

  useEffect(() => {
    fetchTree().then(setCourses)
  }, [])

  const sortedCourses = useMemo(
    () => courses.map((c) => ({ ...c, lectures: [...c.lectures].sort((a, b) => a.name.localeCompare(b.name)) })),
    [courses]
  )

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

  return { courses: sortedCourses, files, refreshCourses, onCourseClick: handleCourseClick }
}
